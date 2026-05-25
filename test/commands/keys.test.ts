import {describe, it, expect, beforeEach, vi} from "vitest";

/**
 * keys/revoke + keys/regenerate use `runWithContext`, so we mock
 * `lib/context.buildContext` to control the active profile + http.
 * Tests verify:
 *   - Path + method composition for revoke/regenerate
 *   - `--env=value` is correctly detected (regression for §6.1)
 *   - `--dryRun` previews without sending
 *   - explicit positional id bypasses profile lookup
 */

const mock = vi.hoisted(() => {
  const requests: Array<{method: string; path: string; pathParams?: any; body?: any}> = [];
  let profile: any = {
    businessId: "biz_1",
    displayName: "Acme",
    defaultEnv: "sandbox",
    envs: {sandbox: {sdkAccessId: "sda_sb", tokenFingerprint: "x"}}
  };
  let activeEnv: "sandbox" | "production" = "sandbox";
  let regenerateBody: any = {sandboxApiSecret: "new_sandbox_secret_xyz"};

  return {
    requests,
    setProfile(p: any) {
      profile = p;
    },
    setActiveEnv(e: "sandbox" | "production") {
      activeEnv = e;
    },
    setRegenerateResponse(body: any) {
      regenerateBody = body;
    },
    reset() {
      requests.length = 0;
      profile = {
        businessId: "biz_1",
        displayName: "Acme",
        defaultEnv: "sandbox",
        envs: {sandbox: {sdkAccessId: "sda_sb", tokenFingerprint: "x"}}
      };
      activeEnv = "sandbox";
      regenerateBody = {sandboxApiSecret: "new_sandbox_secret_xyz"};
    },
    buildContext: async (opts: any) => ({
      env: activeEnv,
      http: {
        baseUrl: "https://api.atoa.me",
        request: async (req: any) => {
          requests.push({method: req.method, path: req.path, pathParams: req.pathParams, body: req.body});
          // regenerate endpoint returns a token; revoke returns nothing meaningful
          if (req.path.includes("regenerate")) {
            return {status: 200, data: regenerateBody, requestId: "r"};
          }
          return {status: 200, data: {}, requestId: "r"};
        }
      },
      format: "json",
      verbose: false,
      dryRun: opts.dryRun ?? false,
      yes: opts.yes ?? true,
      authFingerprint: "RnIs",
      profileName: "acme",
      profile,
      print: () => {}
    })
  };
});

// Force file backend for any side effects in clearLocalForRevoke.
vi.mock("@napi-rs/keyring", () => {
  throw new Error("keyring not available in tests");
});

vi.mock("../../src/lib/context", async () => {
  const actual = await vi.importActual<any>("../../src/lib/context");
  return {...actual, buildContext: mock.buildContext};
});

import revoke from "../../src/commands/keys/revoke";
import regenerate from "../../src/commands/keys/regenerate";

beforeEach(() => {
  mock.reset();
  process.exitCode = 0;
});

describe("keys revoke", () => {
  it("DELETEs /api/cli/api-access/:sdkAccessId for the profile's recorded key", async () => {
    await (revoke.run as any)({args: {yes: true}, rawArgs: []});
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].method).toBe("DELETE");
    expect(mock.requests[0].path).toBe("/api/cli/api-access/:sdkAccessId");
    expect(mock.requests[0].pathParams).toEqual({sdkAccessId: "sda_sb"});
  });

  it("explicit positional id overrides the profile lookup", async () => {
    await (revoke.run as any)({args: {id: "manual-id-123", yes: true}, rawArgs: ["manual-id-123"]});
    expect(mock.requests[0].pathParams).toEqual({sdkAccessId: "manual-id-123"});
  });

  it("--dryRun prints the planned request without sending", async () => {
    await (revoke.run as any)({args: {dryRun: true, yes: true}, rawArgs: []});
    expect(mock.requests).toHaveLength(0);
  });

  it("--env=sandbox (single-token form) is detected — §6.1 regression check", async () => {
    // Two-env profile so the bug would otherwise trigger the interactive prompt
    mock.setProfile({
      businessId: "biz_1",
      displayName: "Acme",
      defaultEnv: "production",
      envs: {
        sandbox: {sdkAccessId: "sda_sb", tokenFingerprint: "x"},
        production: {sdkAccessId: "sda_prod", tokenFingerprint: "y"}
      }
    });
    mock.setActiveEnv("sandbox"); // ctx.env (parseEnvFlag of --env=sandbox)
    await (revoke.run as any)({args: {yes: true}, rawArgs: ["--env=sandbox"]});
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].pathParams).toEqual({sdkAccessId: "sda_sb"});
  });

  it("--env sandbox (two-token form) also detected", async () => {
    mock.setProfile({
      businessId: "biz_1",
      displayName: "Acme",
      defaultEnv: "production",
      envs: {
        sandbox: {sdkAccessId: "sda_sb", tokenFingerprint: "x"},
        production: {sdkAccessId: "sda_prod", tokenFingerprint: "y"}
      }
    });
    mock.setActiveEnv("sandbox");
    await (revoke.run as any)({args: {yes: true}, rawArgs: ["--env", "sandbox"]});
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].pathParams).toEqual({sdkAccessId: "sda_sb"});
  });

  it("errors when profile has no sdkAccessId recorded for that env", async () => {
    mock.setProfile({
      businessId: "biz_1",
      displayName: "Acme",
      defaultEnv: "sandbox",
      envs: {sandbox: {tokenFingerprint: "x"}} // no sdkAccessId
    });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (revoke.run as any)({args: {yes: true}, rawArgs: []});
    expect(process.exitCode).toBe(3); // validation kind
    expect(mock.requests).toHaveLength(0);
    stderr.mockRestore();
  });
});

describe("keys regenerate", () => {
  it("POSTs /api/cli/api-access/:sdkAccessId/regenerate", async () => {
    await (regenerate.run as any)({args: {yes: true}, rawArgs: []});
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].method).toBe("POST");
    expect(mock.requests[0].path).toBe("/api/cli/api-access/:sdkAccessId/regenerate");
    expect(mock.requests[0].pathParams).toEqual({sdkAccessId: "sda_sb"});
  });

  it("errors when server response has no apiSecret", async () => {
    mock.setRegenerateResponse({}); // missing all secret fields
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (regenerate.run as any)({args: {yes: true}, rawArgs: []});
    expect(process.exitCode).toBe(1); // generic kind for "no apiSecret returned"
    stderr.mockRestore();
  });

  it("--dryRun prints the planned request without sending", async () => {
    await (regenerate.run as any)({args: {dryRun: true, yes: true}, rawArgs: []});
    expect(mock.requests).toHaveLength(0);
  });

  it("--env=production single-token form is detected — §6.1 regression check", async () => {
    mock.setProfile({
      businessId: "biz_1",
      displayName: "Acme",
      defaultEnv: "sandbox",
      envs: {
        sandbox: {sdkAccessId: "sda_sb", tokenFingerprint: "x"},
        production: {sdkAccessId: "sda_prod", tokenFingerprint: "y"}
      }
    });
    mock.setActiveEnv("production");
    mock.setRegenerateResponse({productionApiSecret: "new_prod"});
    await (regenerate.run as any)({args: {yes: true}, rawArgs: ["--env=production"]});
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].pathParams).toEqual({sdkAccessId: "sda_prod"});
  });

  it("explicit positional id rotates that specific key", async () => {
    await (regenerate.run as any)({args: {id: "specific-id-999", yes: true}, rawArgs: ["specific-id-999"]});
    expect(mock.requests[0].pathParams).toEqual({sdkAccessId: "specific-id-999"});
  });
});
