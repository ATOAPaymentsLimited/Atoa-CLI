import {describe, it, expect, vi, beforeEach} from "vitest";

const mock = vi.hoisted(() => {
  let nextIdentity: {merchantId: string; businessName: string} = {merchantId: "mid_1", businessName: "Acme Coffee"};
  let lastPrinted: unknown = undefined;
  return {
    setIdentity(v: typeof nextIdentity) {
      nextIdentity = v;
    },
    reset() {
      nextIdentity = {merchantId: "mid_1", businessName: "Acme Coffee"};
      lastPrinted = undefined;
    },
    getPrinted() {
      return lastPrinted;
    },
    buildContext: async () => ({
      env: "sandbox",
      http: {
        baseUrl: "https://api.atoa.me",
        request: async (_req: any) => ({status: 200, data: nextIdentity, requestId: "srv-req-1"})
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
  it("prints the active profile, env, businessName, and fingerprint", async () => {
    mock.setIdentity({merchantId: "mid_42", businessName: "VIGNESH"});
    await (whoami.run as any)({args: {}, rawArgs: []});

    const out = mock.getPrinted() as Record<string, unknown>;
    expect(out.profile).toBe("vignesh");
    expect(out.env).toBe("sandbox");
    expect(out.businessName).toBe("VIGNESH");
    expect(out.tokenFingerprint).toBe("…RnIs");
  });

  it("does NOT leak businessId, sdkAccessId, or baseUrl in output (trimmed display)", async () => {
    await (whoami.run as any)({args: {}, rawArgs: []});
    const out = mock.getPrinted() as Record<string, unknown>;
    expect(out).not.toHaveProperty("businessId");
    expect(out).not.toHaveProperty("sdkAccessId");
    expect(out).not.toHaveProperty("baseUrl");
  });

  it("includes the navigation hint pointing at `atoa profile list`", async () => {
    await (whoami.run as any)({args: {}, rawArgs: []});
    const out = mock.getPrinted() as Record<string, unknown>;
    expect(out.hint).toMatch(/atoa profile list/);
  });
});
