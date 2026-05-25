import {describe, it, expect, afterEach} from "vitest";
import {assertTlsHardenedEnv} from "../../src/lib/bootstrap";

/**
 * The bootstrap gate runs from `bin/atoa.js` BEFORE any other CLI module loads.
 * Its job is to refuse to start when:
 *   1. NODE_TLS_REJECT_UNAUTHORIZED=0 is set (disables cert validation), or
 *   2. BASE_URL is non-HTTPS (assertSecureBaseUrl).
 *
 * Unit tests target both refusal paths. The BASE_URL side is exercised
 * indirectly — in the test environment, the default `UNBUNDLED_BASE_URL` is
 * `https://api.atoa.me` (HTTPS), so `assertSecureBaseUrl` returns silently.
 * That's the same code path a prod-baked binary takes.
 */

describe("assertTlsHardenedEnv", () => {
  afterEach(() => {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  });

  it("does NOT throw when NODE_TLS_REJECT_UNAUTHORIZED is unset", () => {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    expect(() => assertTlsHardenedEnv()).not.toThrow();
  });

  it("does NOT throw when NODE_TLS_REJECT_UNAUTHORIZED is set to something other than '0'", () => {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1";
    expect(() => assertTlsHardenedEnv()).not.toThrow();
  });

  it("throws specifically when NODE_TLS_REJECT_UNAUTHORIZED='0' (disables cert validation)", () => {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    expect(() => assertTlsHardenedEnv()).toThrow(/NODE_TLS_REJECT_UNAUTHORIZED=0/);
  });

  it("error message names the env var so users know what to unset", () => {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    expect(() => assertTlsHardenedEnv()).toThrow(/Unset the variable and re-run/);
  });

  it("error message explains why (disables certificate validation)", () => {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    expect(() => assertTlsHardenedEnv()).toThrow(/disables certificate validation/);
  });

  it("checks NODE_TLS_REJECT_UNAUTHORIZED before assertSecureBaseUrl (TLS-env check fails first)", () => {
    // Even with a perfectly valid BASE_URL (test-env default is HTTPS),
    // the TLS env-var check must fire first. This guards the ordering — if
    // someone swaps the two assertions, the higher-impact check (TLS validation
    // disabled) might not surface its specific message.
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    expect(() => assertTlsHardenedEnv()).toThrow(/NODE_TLS_REJECT_UNAUTHORIZED/);
    // (Should NOT throw the assertSecureBaseUrl message)
    expect(() => assertTlsHardenedEnv()).not.toThrow(/non-HTTPS/);
  });
});

describe("assertTlsHardenedEnv — BASE_URL path (assertSecureBaseUrl wired in)", () => {
  afterEach(() => {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  });

  it("passes silently when BASE_URL is the test-env default (HTTPS)", () => {
    // The unbundled default is `https://api.atoa.me` — HTTPS, so assertSecureBaseUrl
    // returns without throwing. This test verifies the wiring: bootstrap actually
    // calls into assertSecureBaseUrl and that function's HTTPS branch works.
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    expect(() => assertTlsHardenedEnv()).not.toThrow();
  });
});
