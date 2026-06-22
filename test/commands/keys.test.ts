import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import {promises as fs} from "fs";
import {join} from "path";
import {tmpdir} from "os";

/**
 * keys/revoke + keys/regenerate use `runWithContext`, so we mock
 * `lib/context.buildContext` to control the active profile + http.
 *
 * The CLI is JWT-only: keys commands hit the /api/v1/api-keys surface and
 * persist secrets to ~/.atoa/auth/secret_key.json (no OS keychain). We point
 * ATOA_HOME at a temp dir so the sdk-key-file helpers read/write there.
 *
 * Tests verify:
 *   - Path + method composition for revoke/regenerate (v1 routes)
 *   - id resolution: explicit positional id vs latestSdkAccessId(env) from the file
 *   - `--dryRun` previews without sending
 *   - the rotated secret is written to the key file (revoke removes it)
 */

const mock = vi.hoisted(() => {
  const requests: Array<{method: string; path: string; pathParams?: any; query?: any; body?: any}> = [];
  let activeEnv: "sandbox" | "production" = "sandbox";
  let regenerateBody: any = {apiSecret: "new_sandbox_secret_xyz", sdkAccessId: "sda_sb"};
  const printed: unknown[] = [];

  return {
    requests,
    printed,
    setActiveEnv(e: "sandbox" | "production") {
      activeEnv = e;
    },
    setRegenerateResponse(body: any) {
      regenerateBody = body;
    },
    reset() {
      requests.length = 0;
      printed.length = 0;
      activeEnv = "sandbox";
      regenerateBody = {apiSecret: "new_sandbox_secret_xyz", sdkAccessId: "sda_sb"};
    },
    buildContext: async (opts: any) => ({
      env: activeEnv,
      http: {
        baseUrl: "https://api.atoa.me",
        request: async (req: any) => {
          requests.push({
            method: req.method,
            path: req.path,
            pathParams: req.pathParams,
            query: req.query,
            body: req.body
          });
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
      print: (d: unknown) => printed.push(d)
    })
  };
});

vi.mock("../../src/lib/context", async () => {
  const actual = await vi.importActual<any>("../../src/lib/context");
  return {...actual, buildContext: mock.buildContext};
});

import revoke from "../../src/commands/keys/revoke";
import regenerate from "../../src/commands/keys/regenerate";
import {sdkKeyFilePath} from "../../src/lib/sdk-key-file";

let home: string;

async function seedKeyFile(records: any[]): Promise<void> {
  const fp = sdkKeyFilePath();
  await fs.mkdir(join(home, ".atoa", "auth"), {recursive: true});
  await fs.writeFile(fp, JSON.stringify({keys: records}, null, 2) + "\n", {mode: 0o600});
}

async function readKeyFile(): Promise<any> {
  return JSON.parse(await fs.readFile(sdkKeyFilePath(), "utf8"));
}

beforeEach(async () => {
  mock.reset();
  process.exitCode = 0;
  home = await fs.mkdtemp(join(tmpdir(), "atoa-keys-"));
  process.env.ATOA_HOME = home;
});

afterEach(async () => {
  delete process.env.ATOA_HOME;
  await fs.rm(home, {recursive: true, force: true});
});

describe("keys revoke", () => {
  it("DELETEs /api/v1/api-keys/:keyId for the latest recorded key", async () => {
    await seedKeyFile([{env: "sandbox", sdkAccessId: "sda_sb", apiSecret: "s", profile: "acme", createdAt: "t"}]);
    await (revoke.run as any)({args: {yes: true}, rawArgs: []});
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].method).toBe("DELETE");
    expect(mock.requests[0].path).toBe("/api/v1/businesses/:businessId/api-keys/:keyId");
    expect(mock.requests[0].pathParams).toEqual({keyId: "sda_sb"});
  });

  it("removes the revoked entry from the key file", async () => {
    await seedKeyFile([{env: "sandbox", sdkAccessId: "sda_sb", apiSecret: "s", profile: "acme", createdAt: "t"}]);
    await (revoke.run as any)({args: {yes: true}, rawArgs: []});
    const file = await readKeyFile();
    expect(file.keys.find((k: any) => k.sdkAccessId === "sda_sb")).toBeUndefined();
    const out = mock.printed[0] as any;
    expect(out.revoked).toBe(true);
    expect(out.sdkAccessId).toBe("sda_sb");
    expect(out.removedFrom).toBe(sdkKeyFilePath());
  });

  it("explicit positional id overrides the file lookup", async () => {
    await (revoke.run as any)({args: {id: "manual-id-123", yes: true}, rawArgs: ["manual-id-123"]});
    expect(mock.requests[0].pathParams).toEqual({keyId: "manual-id-123"});
  });

  it("--dryRun prints the planned request without sending", async () => {
    await (revoke.run as any)({args: {id: "sda_sb", dryRun: true, yes: true}, rawArgs: ["sda_sb"]});
    expect(mock.requests).toHaveLength(0);
  });

  it("errors when no id given and the key file has nothing for this env", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (revoke.run as any)({args: {yes: true}, rawArgs: []});
    expect(process.exitCode).toBe(3); // validation kind
    expect(mock.requests).toHaveLength(0);
    stderr.mockRestore();
  });
});

describe("keys regenerate", () => {
  it("POSTs /api/v1/api-keys/:keyId/regenerate for the latest recorded key", async () => {
    await seedKeyFile([{env: "sandbox", sdkAccessId: "sda_sb", apiSecret: "s", profile: "acme", createdAt: "t"}]);
    await (regenerate.run as any)({args: {yes: true}, rawArgs: []});
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].method).toBe("POST");
    expect(mock.requests[0].path).toBe("/api/v1/businesses/:businessId/api-keys/:keyId/regenerate");
    expect(mock.requests[0].pathParams).toEqual({keyId: "sda_sb"});
  });

  it("writes the new secret to the key file and prints savedTo", async () => {
    mock.setRegenerateResponse({apiSecret: "rotated_secret_abc"});
    await (regenerate.run as any)({args: {id: "sda_sb", yes: true}, rawArgs: ["sda_sb"]});
    const file = await readKeyFile();
    const entry = file.keys.find((k: any) => k.sdkAccessId === "sda_sb");
    expect(entry.apiSecret).toBe("rotated_secret_abc");
    const out = mock.printed[0] as any;
    expect(out.apiSecret).toBe("rotated_secret_abc");
    expect(out.savedTo).toBe(sdkKeyFilePath());
  });

  it("errors when server response has no apiSecret", async () => {
    mock.setRegenerateResponse({}); // missing apiSecret
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (regenerate.run as any)({args: {id: "sda_sb", yes: true}, rawArgs: ["sda_sb"]});
    expect(process.exitCode).toBe(1); // generic kind for "no apiSecret returned"
    stderr.mockRestore();
  });

  it("--dryRun prints the planned request without sending", async () => {
    await (regenerate.run as any)({args: {id: "sda_sb", dryRun: true, yes: true}, rawArgs: ["sda_sb"]});
    expect(mock.requests).toHaveLength(0);
  });

  it("resolves the latest key for the active env (production)", async () => {
    mock.setActiveEnv("production");
    mock.setRegenerateResponse({apiSecret: "new_prod"});
    await seedKeyFile([
      {env: "sandbox", sdkAccessId: "sda_sb", apiSecret: "s", profile: "acme", createdAt: "t1"},
      {env: "production", sdkAccessId: "sda_prod", apiSecret: "p", profile: "acme", createdAt: "t2"}
    ]);
    await (regenerate.run as any)({args: {yes: true}, rawArgs: ["--env=production"]});
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].pathParams).toEqual({keyId: "sda_prod"});
  });

  it("explicit positional id rotates that specific key", async () => {
    await (regenerate.run as any)({args: {id: "specific-id-999", yes: true}, rawArgs: ["specific-id-999"]});
    expect(mock.requests[0].pathParams).toEqual({keyId: "specific-id-999"});
  });
});
