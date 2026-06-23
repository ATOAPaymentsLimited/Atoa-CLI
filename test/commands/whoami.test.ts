import {describe, it, expect, vi, beforeEach} from "vitest";

const mock = vi.hoisted(() => {
  let nextIdentity: any = {
    id: "user_1",
    firstName: "Vignesh",
    lastName: "K",
    email: "v@example.com",
    phoneCountryCode: "44",
    phoneNumber: "7700900000"
  };
  let lastPrinted: unknown = undefined;
  const requests: Array<{method: string; path: string}> = [];
  return {
    setIdentity(v: any) {
      nextIdentity = v;
    },
    reset() {
      nextIdentity = {
        id: "user_1",
        firstName: "Vignesh",
        lastName: "K",
        email: "v@example.com",
        phoneCountryCode: "44",
        phoneNumber: "7700900000"
      };
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
          return {status: 200, data: nextIdentity, requestId: "srv-req-1"};
        }
      },
      format: "json",
      verbose: false,
      dryRun: false,
      yes: true,
      authFingerprint: "RnIs",
      profileName: "vignesh",
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

describe("whoami", () => {
  it("GETs /api/user/profile/ and prints profile/business/name/email/phone", async () => {
    await (whoami.run as any)({args: {}, rawArgs: []});

    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].path).toBe("/api/user/profile/");

    const out = mock.getPrinted() as Record<string, unknown>;
    expect(out.profile).toBe("vignesh");
    expect(out.business).toBe("Acme Coffee");
    expect(out.name).toBe("Vignesh K");
    expect(out.email).toBe("v@example.com");
    expect(out.phone).toBe("+44 7700900000");
  });

  it("omits name and phone when identity lacks them", async () => {
    mock.setIdentity({id: "user_2", email: "only@example.com"});
    await (whoami.run as any)({args: {}, rawArgs: []});

    const out = mock.getPrinted() as Record<string, unknown>;
    expect(out.name).toBeUndefined();
    expect(out.phone).toBeUndefined();
    expect(out.email).toBe("only@example.com");
  });

  it("does NOT leak env, userId, source, hint, or tokenFingerprint", async () => {
    await (whoami.run as any)({args: {}, rawArgs: []});
    const out = mock.getPrinted() as Record<string, unknown>;
    expect(out).not.toHaveProperty("env");
    expect(out).not.toHaveProperty("userId");
    expect(out).not.toHaveProperty("source");
    expect(out).not.toHaveProperty("hint");
    expect(out).not.toHaveProperty("tokenFingerprint");
  });
});
