import {describe, it, expect} from "vitest";
import {buildAuthHeader, redactAuthHeader, fingerprintToken} from "../../src/lib/auth";

describe("buildAuthHeader", () => {
  it("returns Bearer <token>", () => {
    expect(buildAuthHeader("abc123")).toBe("Bearer abc123");
  });

  it("throws on empty string", () => {
    expect(() => buildAuthHeader("")).toThrow("token is required");
  });
});

describe("redactAuthHeader", () => {
  it("redacts all but last 4 chars", () => {
    expect(redactAuthHeader("Bearer ABCDEFGHIJ")).toBe("Bearer [REDACTED…GHIJ]");
  });

  it("returns <absent> for undefined", () => {
    expect(redactAuthHeader(undefined)).toBe("<absent>");
  });

  it("returns <absent> for empty string", () => {
    expect(redactAuthHeader("")).toBe("<absent>");
  });
});

describe("fingerprintToken", () => {
  it("returns last 4 chars", () => {
    expect(fingerprintToken("ABCDEFGHIJ")).toBe("GHIJ");
  });

  it("handles short tokens", () => {
    expect(fingerprintToken("ab")).toBe("ab");
  });
});
