import {describe, it, expect, vi, beforeEach} from "vitest";

/**
 * whoami JWT-only dispatch tests.
 * whoami GETs /api/user/profile/ and prints {profile, business, name, email, phone}.
 */

const mock = vi.hoisted(() => {
  let lastPrinted: unknown = undefined;
  const requests: Array<{method: string; path: string}> = [];

  return {
    reset() {
      lastPrinted = undefined;
      requests.length = 0;
    },
    getPrinted() {
      return lastPrinted;
    },
    requests,
    buildContext: async () => ({
      env: "sandbox",
      http: {
        baseUrl: "https://api.atoa.me",
        request: async (req: any) => {
          requests.push({method: req.method, path: req.path});
          return {
            status: 200,
            data: {
              id: "user_42",
              firstName: "Ada",
              lastName: "Lovelace",
              email: "ada@example.com",
              phoneCountryCode: "44",
              phoneNumber: "7700900111"
            },
            requestId: "r1"
          };
        }
      },
      format: "json",
      verbose: false,
      dryRun: false,
      yes: true,
      authFingerprint: "RnIs",
      profileName: "acme",
      profile: {businessId: "biz_1", displayName: "Acme Coffee", envs: {sandbox: {tokenFingerprint: "RnIs"}}},
      print: (data: unknown) => {
        lastPrinted = data;
      }
    })
  };
});

vi.mock("../../src/lib/context", async () => {
  const actual = await vi.importActual<any>("../../src/lib/context");
  return {...actual, buildContext: mock.buildContext};
});

import whoami from "../../src/commands/whoami";

beforeEach(() => mock.reset());

describe("whoami — jwt-only", () => {
  it("GETs /api/user/profile/ and prints profile/business/name/email/phone", async () => {
    await (whoami.run as any)({args: {}, rawArgs: []});

    const out = mock.getPrinted() as Record<string, unknown>;
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].method).toBe("GET");
    expect(mock.requests[0].path).toBe("/api/user/profile/");
    expect(out.profile).toBe("acme");
    expect(out.business).toBe("Acme Coffee");
    expect(out.name).toBe("Ada Lovelace");
    expect(out.email).toBe("ada@example.com");
    expect(out.phone).toBe("+44 7700900111");
  });

  it("does not print userId, businessId, source, env, or tokenFingerprint", async () => {
    await (whoami.run as any)({args: {}, rawArgs: []});
    const out = mock.getPrinted() as Record<string, unknown>;
    expect(out).not.toHaveProperty("userId");
    expect(out).not.toHaveProperty("businessId");
    expect(out).not.toHaveProperty("source");
    expect(out).not.toHaveProperty("env");
    expect(out).not.toHaveProperty("tokenFingerprint");
  });
});
