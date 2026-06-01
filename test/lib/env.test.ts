import {describe, it, expect, afterEach} from "vitest";
import {parseEnvFlag, resolveBaseUrl} from "../../src/lib/env";

describe("parseEnvFlag", () => {
  it("defaults to sandbox for undefined", () => expect(parseEnvFlag(undefined)).toBe("sandbox"));
  it("defaults to sandbox for empty string", () => expect(parseEnvFlag("")).toBe("sandbox"));
  it("accepts sandbox", () => expect(parseEnvFlag("sandbox")).toBe("sandbox"));
  it("accepts production", () => expect(parseEnvFlag("production")).toBe("production"));
  it("accepts prod alias", () => expect(parseEnvFlag("prod")).toBe("production"));
  it("rejects unknown values", () => expect(() => parseEnvFlag("staging")).toThrow());
});

describe("resolveBaseUrl", () => {
  const g = globalThis as {BASE_URL?: string};
  const orig = g.BASE_URL;

  afterEach(() => {
    if (orig === undefined) delete g.BASE_URL;
    else g.BASE_URL = orig;
  });

  it("returns the unbundled fallback (prod URL) when BASE_URL is not injected", () => {
    delete g.BASE_URL;
    expect(resolveBaseUrl()).toBe("https://api.atoa.me");
  });

  it("returns the injected BASE_URL when present (simulating a built binary)", () => {
    g.BASE_URL = "https://api.example.test";
    expect(resolveBaseUrl()).toBe("https://api.example.test");
  });
});
