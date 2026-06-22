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
    ["generic", 1],
    [undefined, 1]
  ] as const)("%s → %d", (kind, code) => {
    expect(exitCodeFor(kind as any)).toBe(code);
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
    expect(out).toContain("401");
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
