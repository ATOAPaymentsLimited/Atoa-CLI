import {describe, it, expect, vi} from "vitest";
import {AtoaError, errorCodeOf, exitCodeFor, mapHttpResponse, printError, rawErrorCodeOf} from "../../src/lib/errors";

describe("AtoaError", () => {
  it("sets name and kind", () => {
    const err = new AtoaError("test", "auth");
    expect(err.name).toBe("AtoaError");
    expect(err.kind).toBe("auth");
    expect(err.message).toBe("test");
  });

  it("accepts optional fields", () => {
    const err = new AtoaError("msg", "validation", {status: 400, errorCode: "INVALID", requestId: "r1"});
    expect(err.status).toBe(400);
    expect(err.errorCode).toBe("INVALID");
    expect(err.requestId).toBe("r1");
  });

  it("is instance of Error", () => {
    expect(new AtoaError("x", "generic")).toBeInstanceOf(Error);
  });
});

describe("exitCodeFor", () => {
  it.each([
    ["auth", 2],
    ["forbidden", 2],
    ["validation", 3],
    ["not_found", 4],
    ["rate_limit", 5],
    ["network", 6],
    ["plan_limit", 8],
    ["otp_required", 9],
    ["generic", 1],
    [undefined, 1]
  ] as const)("%s → %d", (kind, code) => {
    expect(exitCodeFor(kind as any)).toBe(code);
  });
});

/**
 * An addon-plan refusal arrives as a 403 carrying the human headline in `title` and the addon's
 * marketing copy in `message`. Read naively that produced, for `atoa stores add`:
 *
 *   error: Manage multiple store locations efficiently and gain flexibility to add employees
 *   and bank accounts. — run 'atoa login' to (re-)authenticate
 */
describe("ADDON_UPGRADE_REQUIRED", () => {
  const body = {
    name: "ADDON_UPGRADE_REQUIRED",
    title: "Upgrade to add more stores",
    message: "Manage multiple store locations efficiently and gain flexibility to add employees.",
    status: 403
  };

  it("is a plan limit, not a forbidden/auth failure", () => {
    const err = mapHttpResponse(403, body, "req-1");
    expect(err.kind).toBe("plan_limit");
    expect(exitCodeFor(err.kind)).toBe(8);
  });

  it("leads with the title and keeps the description as detail", () => {
    const err = mapHttpResponse(403, body, "req-1");
    expect(err.message).toBe("Upgrade to add more stores");
    expect(err.detail).toBe(body.message);
  });

  it("hints at the addon commands and never at re-authenticating", () => {
    let out = "";
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk: any) => {
      out += chunk;
      return true;
    });
    printError(mapHttpResponse(403, body, "req-1"), {authMode: "jwt"});
    stderr.mockRestore();

    expect(out).toContain("atoa addons upgrade");
    expect(out).not.toContain("atoa login");
    expect(out).toContain("Upgrade to add more stores");
  });

  it("leaves an ordinary 403 classified as forbidden with the login hint", () => {
    const err = mapHttpResponse(403, {message: "Forbidden"}, "req-2");
    expect(err.kind).toBe("forbidden");
    expect(err.detail).toBeUndefined();
  });
});

/**
 * The API answers "you may not do this" with 401/403 and a code. Read by status alone they became
 * `auth`, so the CLI printed "run `atoa login`" — which for UNAUTHORIZED_ACCESS mints an identical
 * CLI token and fails identically, because the credential was never the problem.
 */
describe("access refusals are not credential failures", () => {
  const captureStderr = (err: AtoaError): string => {
    let out = "";
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: any) => {
      out += chunk;
      return true;
    });
    printError(err, {authMode: "jwt"});
    spy.mockRestore();
    return out;
  };

  it.each([
    ["UNAUTHORIZED_ACCESS", 401, "Unauthorized"],
    ["ROLE_UNAUTHORIZED_ACCESS", 401, "You don't have permission to do this."],
    ["KYB_VERIFICATION_REQUIRED", 403, "Please verify your business to do this action."]
  ])("%s is forbidden, and never advises re-authenticating", (name, status, message) => {
    const err = mapHttpResponse(status, {name, message}, "req");
    expect(err.kind).toBe("forbidden");
    expect(captureStderr(err)).not.toContain("atoa login");
  });

  it("tells the user the endpoint is closed to CLI tokens, not that their session died", () => {
    const out = captureStderr(mapHttpResponse(401, {name: "UNAUTHORIZED_ACCESS", message: "Unauthorized"}, "req"));
    expect(out).toContain("not available to CLI tokens");
  });

  it("keeps the merchant status from `title` as detail on a KYB refusal", () => {
    const err = mapHttpResponse(
      403,
      {name: "KYB_VERIFICATION_REQUIRED", message: "Please verify your business to do this action.", title: "KYB_HOLD"},
      "req"
    );
    expect(err.detail).toContain("KYB_HOLD");
    expect(err.message).toBe("Please verify your business to do this action.");
    expect(captureStderr(err)).toContain("atoa kyb status");
  });

  // These 401s describe the OTP, not the session. withOtp normally intercepts them, so this covers
  // the case where a caller that isn't OTP-aware surfaces one: "run `atoa login`" over a mistyped
  // code sends the user to fix something that was never broken.
  it.each([
    ["OTP_VERIFICATION_IS_REQUIRED", "Please verify with the OTP sent to you."],
    ["BANK_INCORRECT_OTP", "Incorrect code used. 3 attempts remaining"],
    ["BANK_OTP_CODE_EXPIRED", "Code expired."]
  ])("%s is bad input, not a dead session", (name, message) => {
    const err = mapHttpResponse(401, {name, message}, "req");
    expect(err.kind).toBe("validation");
    expect(exitCodeFor(err.kind)).toBe(3);
    expect(captureStderr(err)).not.toContain("atoa login");
  });

  // The cooldown message says "wait N seconds"; classified as auth it printed "run `atoa login`"
  // underneath — advising the very action that caused the lockout.
  it("never advises re-authenticating during a sign-in cooldown", () => {
    const err = mapHttpResponse(
      401,
      {name: "AUTHENTICATION_COOLDOWN", message: "Please wait for 300 seconds before retrying"},
      "req"
    );
    expect(err.kind).toBe("rate_limit");
    expect(captureStderr(err)).not.toContain("atoa login");
  });

  it("leaves a genuine dead token as auth with the login hint", () => {
    const err = mapHttpResponse(401, {name: "INVALID_CREDENTIAL", message: "Invalid token. Expired."}, "req");
    expect(err.kind).toBe("auth");
    expect(captureStderr(err)).toContain("atoa login");
  });
});

/** Three services put the code in three different fields, and two of them put non-codes there. */
describe("errorCodeOf", () => {
  it("reads `customName`, which on some bodies arrives with no `name` beside it", () => {
    expect(errorCodeOf({message: "blocked", customName: "BANK_OTP_LIMIT_REACH"})).toBe("BANK_OTP_LIMIT_REACH");
  });

  it.each([
    ["the placeholder for an uncoded error", {name: "BAD_REQUEST"}],
    ["a NestJS class name", {name: "HttpException"}],
    ["a NestJS validation class name", {name: "BadRequestException"}],
    ["an empty string", {errorCode: "   "}],
    ["a non-object body", "nope"]
  ])("returns undefined for %s", (_label, body) => {
    expect(errorCodeOf(body)).toBeUndefined();
  });

  it("still prefers an explicit errorCode over the other two fields", () => {
    expect(errorCodeOf({errorCode: "ERR_X", name: "BAD_REQUEST", customName: "ERR_Y"})).toBe("ERR_X");
  });

  // Scanning, not narrowing-the-first: a class name in `name` must not hide a real code beside it,
  // or classification silently falls back to matching the message wording.
  it("skips a non-code marker to reach a real one further down", () => {
    expect(errorCodeOf({name: "CustomUnauthorized", customName: "BANK_OTP_LIMIT_REACH"})).toBe("BANK_OTP_LIMIT_REACH");
    expect(errorCodeOf({name: "BAD_REQUEST", customName: "BANK_OTP_LIMIT_REACH"})).toBe("BANK_OTP_LIMIT_REACH");
  });

  // The replay guard reads raw and must still see the FIRST marker, whatever its shape — narrowing
  // here would report "no code" and grant a refresh-and-replay that re-sends the request.
  it("rawErrorCodeOf keeps a marker that errorCodeOf discards", () => {
    expect(rawErrorCodeOf({name: "BAD_REQUEST"})).toBe("BAD_REQUEST");
    expect(errorCodeOf({name: "BAD_REQUEST"})).toBeUndefined();
  });
});

describe("mapHttpResponse", () => {
  it.each([
    [401, "auth"],
    [403, "forbidden"],
    [400, "validation"],
    [422, "validation"],
    [404, "not_found"],
    [429, "rate_limit"],
    [500, "generic"],
    [503, "generic"]
  ] as const)("HTTP %d → kind %s", (status, kind) => {
    expect(mapHttpResponse(status, {}, "req").kind).toBe(kind);
  });

  it("extracts message and errorCode from body", () => {
    const err = mapHttpResponse(400, {message: "bad input", errorCode: "ERR_BAD"}, "req-1");
    expect(err.message).toBe("bad input");
    expect(err.errorCode).toBe("ERR_BAD");
    expect(err.requestId).toBe("req-1");
  });

  it("falls back to HTTP N when no message in body", () => {
    expect(mapHttpResponse(503, {}, "x").message).toBe("HTTP 503");
  });

  // The API throws several different shapes for an OTP throttle: the bank surface tags a 401 with a
  // code, every other surface throws a bare 400 carrying only the wording. Each is a "wait", not an
  // auth failure — misclassifying any of them advises `atoa login` instead.
  it.each([
    [
      "bank, 1 minute",
      401,
      {
        name: "BANK_OTP_ONE_MINUTE_LIMIT_REACH",
        message: "You have reached the maximum number of OTP requests within 60 seconds. Please try again in a minute!"
      }
    ],
    [
      "bank, wrong code too often",
      401,
      {
        name: "BANK_OTP_LIMIT_REACH",
        message: "You've entered the incorrect code too many times. Please wait 60 minutes before trying again."
      }
    ],
    [
      "bank, verification limit",
      401,
      {name: "BANK_OTP_VERIFICATION_LIMIT_REACH", message: "Too many failed attempts."}
    ],
    // Not an OTP throttle at all — a sign-in lockout after repeated failures. Classified by code
    // rather than by wording, so a copy edit backend-side can't turn it back into "run atoa login".
    [
      "sign-in cooldown",
      401,
      {
        name: "AUTHENTICATION_COOLDOWN",
        message: "Please wait for 300 seconds before retrying",
        additionalData: {retryAfterSeconds: 300, cooldownType: "PASSWORD"}
      }
    ],
    [
      "non-bank, 1 hour",
      400,
      {message: "You have reached the maximum number of OTP requests within 1 hour. Please try again in an hour!"}
    ],
    [
      "non-bank, 1 minute",
      400,
      {message: "You have reached the maximum number of OTP requests within 60 seconds. Please try again in a minute!"}
    ],
    // The wrong-code lockout, as opposed to the send throttle above. The non-bank surface carries no
    // code at all here, so a 400 left as `validation` reads as "retype it" — which can never work.
    [
      "non-bank, wrong code too often",
      400,
      {name: "HttpException", message: "Maximum number of attempts reached. Please generate a new OTP."}
    ],
    [
      "bank, hour block after wrong codes",
      400,
      {
        name: "BANK_OTP_VERIFICATION_LIMIT_REACH",
        message: "Too many failed attempts. Please try again after 60 minutes."
      }
    ]
  ])("classifies an OTP throttle as rate_limit — %s", (_label, status, body) => {
    const err = mapHttpResponse(status, body, "req");
    expect(err.kind).toBe("rate_limit");
    expect(exitCodeFor(err.kind)).toBe(5);
  });

  // The retryable wrong-code reply is a 400 too, and must stay `validation` — classifying it as a
  // throttle would abandon the prompt while the user still had attempts left.
  it.each([
    ["attempts remain", {message: "Incorrect code used. 2 attempts remaining"}],
    ["bank, attempts remain", {name: "BANK_INCORRECT_OTP", message: "Incorrect code used. 1 attempt remaining"}]
  ])("keeps a retryable wrong code as validation — %s", (_label, body) => {
    expect(mapHttpResponse(400, body, "req").kind).toBe("validation");
  });

  it("uses the body `name` (trimmed) as errorCode when no explicit errorCode is present", () => {
    // Backend OTP gate throws {name: "OTP_VERIFICATION_IS_REQUIRED ", message, status}
    const err = mapHttpResponse(400, {name: "OTP_VERIFICATION_IS_REQUIRED ", message: "enter the OTP"}, "req-2");
    expect(err.errorCode).toBe("OTP_VERIFICATION_IS_REQUIRED");
  });

  it("prefers an explicit errorCode over `name`", () => {
    const err = mapHttpResponse(400, {name: "BAD_REQUEST", errorCode: "ERR_X"}, "req-3");
    expect(err.errorCode).toBe("ERR_X");
  });
});

/**
 * A lockout can arrive tagged with a wrong-code marker and lockout wording at the same time. The
 * code arm classifies that as plain bad input, which reads as "try again" — so the throttle arm
 * runs last and wins. Getting this backwards is what makes the caller spend attempts into a block.
 */
describe("a throttle outranks the code that arrives with it", () => {
  it("stays rate_limit when a wrong-code marker carries lockout wording", () => {
    const err = mapHttpResponse(
      401,
      {name: "BANK_INCORRECT_OTP", message: "You have entered the incorrect code too many times."},
      "r"
    );

    expect(err.kind).toBe("rate_limit");
    expect(exitCodeFor(err.kind)).toBe(5);
  });

  it("still reads an ordinary wrong code as bad input", () => {
    const err = mapHttpResponse(401, {name: "BANK_INCORRECT_OTP", message: "Incorrect code."}, "r");

    // The negative control: without the lockout wording this must stay retryable, or withOtp
    // would stop asking after the first typo.
    expect(err.kind).toBe("validation");
    expect(exitCodeFor(err.kind)).toBe(3);
  });

  it("keeps the addon headline even if another arm wins the classification", () => {
    // The headline is chosen from the error code, not from whichever `kind` was assigned last —
    // otherwise reordering the arms would silently swap a useful title for marketing copy.
    const err = mapHttpResponse(
      403,
      {
        name: "ADDON_UPGRADE_REQUIRED",
        title: "Add more store locations",
        message: "Maximum number of attempts reached."
      },
      "r"
    );

    expect(err.message).toBe("Add more store locations");
  });

  it("does not let an expired-code marker mask a send limit", () => {
    const err = mapHttpResponse(
      401,
      {name: "BANK_OTP_CODE_EXPIRED", message: "Maximum number of OTP requests reached."},
      "r"
    );

    expect(err.kind).toBe("rate_limit");
  });
});

describe("printError", () => {
  it("writes AtoaError details to stderr", () => {
    const spy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    printError(new AtoaError("failed", "auth", {status: 401, requestId: "r1"}));
    const out = spy.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toContain("failed");
    expect(out).toContain("r1");
    spy.mockRestore();
  });

  it("writes plain Error message", () => {
    const spy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    printError(new Error("plain"));
    expect(spy.mock.calls.map((c) => String(c[0])).join("")).toContain("plain");
    spy.mockRestore();
  });

  it("handles non-Error values", () => {
    const spy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    printError("oops");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
