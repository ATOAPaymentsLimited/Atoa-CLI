import {describe, it, expect, vi, beforeEach} from "vitest";

const state = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  secrets: {} as Record<string, string>,
  httpResponses: [] as Array<{status?: number; data: unknown}>,
  httpCalls: [] as Array<{method: string; path: string; body?: unknown; auth: string}>
}));

vi.mock("../../src/lib/config-store", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/config-store")>("../../src/lib/config-store");
  return {
    ...actual,
    readConfig: vi.fn(async () => ({...state.config})),
    writeConfig: vi.fn(async (c: Record<string, unknown>) => {
      state.config = {...c};
    }),
    configFilePath: () => "/tmp/atoa-test-config",
    writeProfile: vi.fn(async (name: string, profile: Record<string, unknown>) => {
      const profiles = (state.config.profiles as Record<string, unknown>) ?? {};
      state.config.profiles = {...profiles, [name]: profile};
    }),
    readProfile: vi.fn(async (name: string) => {
      const profiles = state.config.profiles as Record<string, unknown> | undefined;
      return profiles?.[name];
    })
  };
});

vi.mock("../../src/lib/secrets-store", () => ({
  createSecretsStore: async () => ({
    backend: () => "file",
    async get(profile: string, env: string) {
      return state.secrets[`${profile}:${env}`];
    },
    async set(profile: string, env: string, token: string) {
      state.secrets[`${profile}:${env}`] = token;
    },
    async delete(profile: string, env: string) {
      delete state.secrets[`${profile}:${env}`];
    },
    async deleteProfile(profile: string) {
      delete state.secrets[`${profile}:sandbox`];
      delete state.secrets[`${profile}:production`];
    }
  }),
  configHomeDir: () => "/tmp/atoa-test-home"
}));

vi.mock("../../src/lib/http", () => ({
  assertTlsHardenedEnv: () => {},
  buildHttpClient: ({authHeader}: {authHeader: string}) => ({
    baseUrl: "https://api.atoa.me",
    request: async ({method, path, body}: {method: string; path: string; body?: unknown}) => {
      state.httpCalls.push({method, path, body, auth: authHeader});
      const next = state.httpResponses.shift();
      if (!next) throw new Error(`no mock response for ${method} ${path}`);
      return {status: next.status ?? 200, data: next.data, requestId: "r"};
    }
  })
}));

// `select` only fires when stdin is a TTY. In test runs it isn't, so the
// command always reads --env from args; mock it as a fallback anyway.
vi.mock("@inquirer/prompts", () => ({
  password: vi.fn(async () => "pasted-token-1234"),
  select: vi.fn(async () => "sandbox")
}));

import login from "../../src/commands/login";

let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  state.config = {};
  state.secrets = {};
  state.httpResponses = [];
  state.httpCalls = [];
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  process.exitCode = undefined;
});

describe("login (paste flow)", () => {
  it("stores the token under <profile>:<env> derived from businessName and validates via /api/cli/identity", async () => {
    state.httpResponses = [{data: {merchantId: "mid_1", businessName: "Acme Coffee"}}];
    await (login.run as any)({args: {env: "production"}, rawArgs: []});
    expect(state.secrets["acme-coffee:production"]).toBe("pasted-token-1234");
    expect(state.httpCalls[0].path).toBe("/api/cli/identity");
    expect((state.config.profiles as Record<string, unknown>)["acme-coffee"]).toBeDefined();
    expect(state.config.activeProfile).toBe("acme-coffee");
    const out = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    expect(out).toMatch(/business: Acme Coffee/);
    expect(out).toMatch(/profile "acme-coffee"/);
  });

  it("honours an explicit --profile flag", async () => {
    state.httpResponses = [{data: {merchantId: "mid_2", businessName: "Acme Coffee"}}];
    await (login.run as any)({args: {env: "sandbox", profile: "work"}, rawArgs: []});
    expect(state.secrets["work:sandbox"]).toBe("pasted-token-1234");
    expect((state.config.profiles as Record<string, unknown>)["work"]).toBeDefined();
  });

  it("rejects an empty token", async () => {
    const prompts = await import("@inquirer/prompts");
    (prompts.password as any).mockResolvedValueOnce("   ");
    await (login.run as any)({args: {env: "sandbox"}, rawArgs: []});
    expect(Object.keys(state.secrets)).toHaveLength(0);
    expect(process.exitCode).toBe(3); // validation
  });

  it("refuses to store a token when /api/cli/identity reports a different env than the user picked", async () => {
    // User picks env=sandbox but the pasted token authenticates as PRODUCTION.
    state.httpResponses = [
      {
        data: {
          merchantId: "mid_1",
          businessName: "Acme Coffee",
          key: {sdkAccessId: "sda_1", env: "PRODUCTION", keyType: "DEFAULT"}
        }
      }
    ];
    await (login.run as any)({args: {env: "sandbox"}, rawArgs: []});
    expect(Object.keys(state.secrets)).toHaveLength(0);
    expect((state.config.profiles as Record<string, unknown> | undefined)?.["acme-coffee"]).toBeUndefined();
    expect(process.exitCode).toBe(3); // validation
    const err = stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    expect(err).toMatch(/this token belongs to production but you picked sandbox/);
  });

  it("records sdkAccessId from the server response (keyType from server is ignored locally)", async () => {
    state.httpResponses = [
      {
        data: {
          merchantId: "mid_5",
          businessName: "Test Co",
          key: {sdkAccessId: "sda_xyz", env: "SANDBOX", keyType: "DEFAULT"}
        }
      }
    ];
    await (login.run as any)({args: {env: "sandbox"}, rawArgs: []});
    const profile = (
      state.config.profiles as Record<string, {envs: Record<string, {sdkAccessId?: string; tokenFingerprint: string}>}>
    )["test-co"];
    expect(profile.envs.sandbox).toMatchObject({
      sdkAccessId: "sda_xyz",
      tokenFingerprint: "1234"
    });
    expect(profile.envs.sandbox).not.toHaveProperty("keyType");
  });

  it("switches activeProfile to the newly-logged-in profile when a different one was active", async () => {
    state.config = {
      activeProfile: "old-profile",
      profiles: {"old-profile": {businessId: "mid_old"}}
    };
    state.httpResponses = [{data: {merchantId: "mid_new", businessName: "New Business"}}];
    await (login.run as any)({args: {env: "production"}, rawArgs: []});
    expect(state.config.activeProfile).toBe("new-business");
    const out = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    expect(out).toMatch(/now active/);
  });

  it("preserves the OTHER env state when paste overwrites just one", async () => {
    state.config = {
      schemaVersion: 1,
      activeProfile: "acme-coffee",
      profiles: {
        "acme-coffee": {
          businessId: "mid_1",
          displayName: "Acme Coffee",
          envs: {
            sandbox: {sdkAccessId: "sda_sand", tokenFingerprint: "aaaa"},
            production: {sdkAccessId: "sda_prod", tokenFingerprint: "bbbb"}
          }
        }
      }
    };
    state.secrets["acme-coffee:sandbox"] = "old-sand";
    state.secrets["acme-coffee:production"] = "old-prod";

    // Paste-overwrite ONLY production.
    state.httpResponses = [
      {
        data: {
          merchantId: "mid_1",
          businessName: "Acme Coffee",
          key: {sdkAccessId: "sda_prod_new", env: "PRODUCTION", keyType: "DEFAULT"}
        }
      }
    ];
    await (login.run as any)({args: {env: "production"}, rawArgs: []});

    expect(state.secrets["acme-coffee:production"]).toBe("pasted-token-1234");
    expect(state.secrets["acme-coffee:sandbox"]).toBe("old-sand");

    const profile = (
      state.config.profiles as Record<string, {envs: Record<string, {sdkAccessId?: string; tokenFingerprint: string}>}>
    )["acme-coffee"];
    expect(profile.envs.sandbox).toMatchObject({sdkAccessId: "sda_sand"});
    expect(profile.envs.production).toMatchObject({sdkAccessId: "sda_prod_new"});
    expect(profile.envs.production.tokenFingerprint).toBe("1234");
  });
});
