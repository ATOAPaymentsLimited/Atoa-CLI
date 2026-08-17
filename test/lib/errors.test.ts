import {describe, it, expect, vi} from "vitest";
import {AtoaError, exitCodeFor, mapHttpResponse, printError} from "../../src/lib/errors";

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
