import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import {promises as fs} from "fs";
import {join} from "path";
import {tmpdir} from "os";

/**
 * keys create / list / regenerate / revoke.
 *
 * The CLI is JWT-only — there is no auth-mode guard and no sdk-paste branch.
 * Commands hit /api/v1/api-keys and persist secrets to the key file at
 * ~/.atoa/auth/secret_key.json (no OS keychain). We point ATOA_HOME at a temp
 * dir so the sdk-key-file helpers read/write there, and we drive forbidden
 * responses through a mock flag.
 */

const mock = vi.hoisted(() => {
  const requests: Array<{method: string; path: string; pathParams?: any; query?: any; body?: any; auth?: string}> = [];
  let activeEnv: "sandbox" | "production" = "sandbox";
  let createResponse: any = {apiSecret: "sk_live_new_secret", sdkAccessId: "sda_new"};
  let listResponse: any = [{id: "sda_sb", env: "sandbox", createdAt: "2024-01-01"}];
  let regenerateResponse: any = {apiSecret: "sk_regen_secret"};
  let forbid = false;
  const printed: unknown[] = [];

  return {
    requests,
    printed,
    setActiveEnv(e: "sandbox" | "production") {
      activeEnv = e;
    },
    setCreateResponse(r: any) {
      createResponse = r;
    },
    setListResponse(r: any) {
      listResponse = r;
    },
    setRegenerateResponse(r: any) {
      regenerateResponse = r;
    },
    setForbidden(v: boolean) {
      forbid = v;
    },
    reset() {
      requests.length = 0;
      printed.length = 0;
      activeEnv = "sandbox";
      createResponse = {apiSecret: "sk_live_new_secret", id: "sda_new"};
      listResponse = [{id: "sda_sb", env: "sandbox", createdAt: "2024-01-01"}];
      regenerateResponse = {apiSecret: "sk_regen_secret"};
      forbid = false;
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
            body: req.body,
            auth: req.auth
          });
          if (forbid) {
            const {AtoaError} = await import("../../src/lib/errors");
            throw new AtoaError("Forbidden", "forbidden", {status: 403, requestId: "r"});
          }
          if (req.path === "/api/merchant/:businessId/v1/api-access/:env" && req.method === "POST") {
            return {status: 200, data: createResponse, requestId: "r"};
          }
          if (req.path === "/api/merchant/:businessId/v1/api-access" && req.method === "GET") {
            return {status: 200, data: listResponse, requestId: "r"};
          }
          if (req.path === "/api/merchant/:businessId/v1/api-access/:keyId/revoke" && req.method === "PUT") {
            return {status: 200, data: regenerateResponse, requestId: "r"};
          }
          if (req.path === "/api/merchant/:businessId/v1/api-access/:keyId" && req.method === "DELETE") {
            return {status: 200, data: {}, requestId: "r"};
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

import createKey from "../../src/commands/keys/create";
import listKeys from "../../src/commands/keys/list";
import regenerate from "../../src/commands/keys/regenerate";
import revoke from "../../src/commands/keys/revoke";
import {sdkKeyFilePath} from "../../src/lib/sdk-key-file";

let home: string;

async function seedKeyFile(records: any[]): Promise<void> {
  await fs.mkdir(join(home, ".atoa", "auth"), {recursive: true});
  await fs.writeFile(sdkKeyFilePath(), JSON.stringify({keys: records}, null, 2) + "\n", {mode: 0o600});
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

// ─── keys create ─────────────────────────────────────────────────────────────

describe("keys create", () => {
  it("POSTs /api/merchant/:businessId/v1/api-access/:env with env=sandbox", async () => {
    await (createKey.run as any)({args: {yes: true, name: "Test key"}, rawArgs: []});
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].method).toBe("POST");
    expect(mock.requests[0].path).toBe("/api/merchant/:businessId/v1/api-access/:env");
    expect(mock.requests[0].auth).toBe("jwt");
    expect(mock.requests[0].pathParams).toEqual({env: "sandbox"});
    expect(mock.requests[0].body).toMatchObject({name: "Test key"});
  });

  it("writes the apiSecret to the key file and prints savedTo", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (createKey.run as any)({args: {yes: true, name: "Test key"}, rawArgs: []});

    const file = await readKeyFile();
    const entry = file.keys.find((k: any) => k.sdkAccessId === "sda_new");
    expect(entry.apiSecret).toBe("sk_live_new_secret");
    expect(entry.env).toBe("sandbox");
    expect(entry.profile).toBe("acme");

    const out = mock.printed[0] as any;
    expect(out.apiSecret).toBe("sk_live_new_secret");
    expect(out.sdkAccessId).toBe("sda_new");
    expect(out.savedTo).toBe(sdkKeyFilePath());

    const errOutput = stderr.mock.calls.map((c) => String(c[0])).join("");
    expect(errOutput).toMatch(/SDK key written to/);
    stderr.mockRestore();
  });

  it("errors when server response has no apiSecret", async () => {
    mock.setCreateResponse({sdkAccessId: "sda_new"});
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (createKey.run as any)({args: {yes: true, name: "Test key"}, rawArgs: []});
    expect(process.exitCode).toBe(1); // generic kind
    stderr.mockRestore();
  });

  it("surfaces 403 as 'requires an admin role'", async () => {
    mock.setForbidden(true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (createKey.run as any)({args: {yes: true, name: "Test key"}, rawArgs: []});
    const errOutput = stderr.mock.calls.map((c) => String(c[0])).join("");
    expect(errOutput).toMatch(/admin role/);
    stderr.mockRestore();
  });

  it("--dryRun does not send the request", async () => {
    await (createKey.run as any)({args: {yes: true, name: "Test key", dryRun: true}, rawArgs: []});
    expect(mock.requests).toHaveLength(0);
  });
});

// ─── keys list ───────────────────────────────────────────────────────────────

describe("keys list", () => {
  it("GETs /api/v1/api-keys", async () => {
    await (listKeys.run as any)({args: {yes: true}, rawArgs: []});
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].method).toBe("GET");
    expect(mock.requests[0].path).toBe("/api/merchant/:businessId/v1/api-access");
    expect(mock.requests[0].auth).toBe("jwt");
  });

  it("prints the rows array (non-TTY) without exposing secrets", async () => {
    mock.setListResponse([{id: "sda_1", env: "sandbox", createdAt: "2024-01-01"}]);
    await (listKeys.run as any)({args: {yes: true}, rawArgs: []});
    expect(mock.requests[0].path).toBe("/api/merchant/:businessId/v1/api-access");
    const out = mock.printed[0] as any[];
    expect(out).toEqual([{id: "sda_1", env: "sandbox", createdAt: "2024-01-01"}]);
    expect(JSON.stringify(out)).not.toMatch(/apiSecret/);
  });
});

// ─── keys regenerate ─────────────────────────────────────────────────────────

describe("keys regenerate", () => {
  it("PUTs /api/merchant/:businessId/v1/api-access/:keyId/revoke for the latest recorded key", async () => {
    await seedKeyFile([{env: "sandbox", sdkAccessId: "sda_sb", apiSecret: "s", profile: "acme", createdAt: "t"}]);
    await (regenerate.run as any)({args: {yes: true}, rawArgs: []});
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].method).toBe("PUT");
    expect(mock.requests[0].path).toBe("/api/merchant/:businessId/v1/api-access/:keyId/revoke");
    expect(mock.requests[0].pathParams).toEqual({keyId: "sda_sb"});
    expect(mock.requests[0].auth).toBe("jwt");
  });

  it("surfaces 403 as admin-role message", async () => {
    mock.setForbidden(true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (regenerate.run as any)({args: {id: "sda_sb", yes: true}, rawArgs: ["sda_sb"]});
    const errOutput = stderr.mock.calls.map((c) => String(c[0])).join("");
    expect(errOutput).toMatch(/admin role/);
    stderr.mockRestore();
  });

  it("--dryRun does not send the request", async () => {
    await (regenerate.run as any)({args: {id: "sda_sb", yes: true, dryRun: true}, rawArgs: ["sda_sb"]});
    expect(mock.requests).toHaveLength(0);
  });
});

// ─── keys revoke ───────────────────────────────────────────────────────────

describe("keys revoke", () => {
  it("DELETEs /api/v1/api-keys/:keyId for the latest recorded key", async () => {
    await seedKeyFile([{env: "sandbox", sdkAccessId: "sda_sb", apiSecret: "s", profile: "acme", createdAt: "t"}]);
    await (revoke.run as any)({args: {yes: true}, rawArgs: []});
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].method).toBe("DELETE");
    expect(mock.requests[0].path).toBe("/api/merchant/:businessId/v1/api-access/:keyId");
    expect(mock.requests[0].pathParams).toEqual({keyId: "sda_sb"});
    expect(mock.requests[0].auth).toBe("jwt");
  });

  it("surfaces 403 as admin-role message", async () => {
    mock.setForbidden(true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (revoke.run as any)({args: {id: "sda_sb", yes: true}, rawArgs: ["sda_sb"]});
    const errOutput = stderr.mock.calls.map((c) => String(c[0])).join("");
    expect(errOutput).toMatch(/admin role/);
    stderr.mockRestore();
  });

  it("--dryRun does not send the request", async () => {
    await (revoke.run as any)({args: {id: "sda_sb", yes: true, dryRun: true}, rawArgs: ["sda_sb"]});
    expect(mock.requests).toHaveLength(0);
  });
});
