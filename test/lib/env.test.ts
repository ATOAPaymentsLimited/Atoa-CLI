import {describe, it, expect, afterEach} from "vitest";
import {parseEnvFlag, resolveBaseUrl, assertSecureBaseUrl, assertSecureDashboardUrl} from "../../src/lib/env";

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

describe("assertSecureBaseUrl", () => {
  const orig = {base: process.env.ATOA_BASE_URL, insecure: process.env.ATOA_ALLOW_INSECURE};

  afterEach(() => {
    for (const [k, v] of [
      ["ATOA_BASE_URL", orig.base],
      ["ATOA_ALLOW_INSECURE", orig.insecure]
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("allows https://", () => {
    process.env.ATOA_BASE_URL = "https://api.atoa.me";
    expect(() => assertSecureBaseUrl()).not.toThrow();
  });

  it("rejects http:// without the opt-in flag", () => {
    process.env.ATOA_BASE_URL = "http://localhost:9090/server";
    delete process.env.ATOA_ALLOW_INSECURE;
    expect(() => assertSecureBaseUrl()).toThrow(/must be https/);
  });

  it("allows http:// on loopback WITH the opt-in flag", () => {
    process.env.ATOA_BASE_URL = "http://localhost:9090/server";
    process.env.ATOA_ALLOW_INSECURE = "1";
    expect(() => assertSecureBaseUrl()).not.toThrow();
  });

  it("still rejects http:// on a remote host even WITH the flag", () => {
    process.env.ATOA_BASE_URL = "http://api.evil.test/server";
    process.env.ATOA_ALLOW_INSECURE = "1";
    expect(() => assertSecureBaseUrl()).toThrow(/must be https/);
  });
});

describe("assertSecureDashboardUrl", () => {
  const orig = {dash: process.env.ATOA_DASHBOARD_URL, insecure: process.env.ATOA_ALLOW_INSECURE};

  afterEach(() => {
    for (const [k, v] of [
      ["ATOA_DASHBOARD_URL", orig.dash],
      ["ATOA_ALLOW_INSECURE", orig.insecure]
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("allows https://", () => {
    process.env.ATOA_DASHBOARD_URL = "https://dashboard.paywithatoa.co.uk";
    expect(() => assertSecureDashboardUrl()).not.toThrow();
  });

  it("rejects an http:// dashboard without the opt-in flag", () => {
    process.env.ATOA_DASHBOARD_URL = "http://localhost:3000";
    delete process.env.ATOA_ALLOW_INSECURE;
    expect(() => assertSecureDashboardUrl()).toThrow(/DASHBOARD_URL.*must be https/);
  });

  it("allows http:// on loopback WITH the opt-in flag", () => {
    process.env.ATOA_DASHBOARD_URL = "http://localhost:3000";
    process.env.ATOA_ALLOW_INSECURE = "1";
    expect(() => assertSecureDashboardUrl()).not.toThrow();
  });

  it("still rejects an http:// remote dashboard even WITH the flag", () => {
    process.env.ATOA_DASHBOARD_URL = "http://evil.test";
    process.env.ATOA_ALLOW_INSECURE = "1";
    expect(() => assertSecureDashboardUrl()).toThrow(/DASHBOARD_URL.*must be https/);
  });
});
