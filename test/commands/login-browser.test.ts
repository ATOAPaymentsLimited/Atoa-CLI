import {describe, it, expect, vi, beforeEach, afterEach} from "vitest";

const state = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  secrets: {} as Record<string, string>,
  jwt: {} as Record<string, {accessToken: string; refreshToken: string}>,
  httpResponses: [] as Array<{status?: number; data?: unknown; error?: Error}>,
  httpCalls: [] as Array<{method: string; path: string; body?: unknown; query?: unknown; auth?: string}>,
  loopback: {
    port: 43210,
    started: 0,
    opts: undefined as undefined | {expectedState: string; timeoutMs?: number},
    result: undefined as undefined | (() => Promise<{code: string}>)
  },
  browser: {urls: [] as string[], opens: true},
  activeBusinessCalls: [] as Array<{profile: string; businessId: string}>
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
    }),
    getOrCreateClientDeviceId: vi.fn(async () => "device-uuid-1"),
    getDeviceName: vi.fn(() => "test-host"),
    setActiveBusinessId: vi.fn(async (profile: string, businessId: string) => {
      state.activeBusinessCalls.push({profile, businessId});
      const profiles = (state.config.profiles as Record<string, Record<string, unknown>>) ?? {};
      if (profiles[profile]) profiles[profile].activeBusinessId = businessId;
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
    },
    async setJwtTokens(profile: string, tokens: {accessToken: string; refreshToken: string}) {
      state.jwt[profile] = tokens;
    },
    async getJwtTokens(profile: string) {
      return state.jwt[profile] ?? null;
    },
    async clearJwtTokens(profile: string) {
      delete state.jwt[profile];
    }
  }),
  configHomeDir: () => "/tmp/atoa-test-home"
}));

vi.mock("../../src/lib/http", () => ({
  assertTlsHardenedEnv: () => {},
  buildHttpClient: () => ({
    baseUrl: "https://api.atoa.me",
    request: async ({
      method,
      path,
      body,
      query,
      auth
    }: {
      method: string;
      path: string;
      body?: unknown;
      query?: unknown;
      auth?: string;
    }) => {
      state.httpCalls.push({method, path, body, query, auth});
      const next = state.httpResponses.shift();
      if (!next) throw new Error(`no mock response for ${method} ${path}`);
      if (next.error) throw next.error;
      return {status: next.status ?? 200, data: next.data, requestId: "r"};
    }
  })
}));

vi.mock("../../src/lib/pkce", () => ({
  generatePkcePair: () => ({verifier: "test-verifier", challenge: "test-challenge"}),
  generateState: () => "test-state"
}));

vi.mock("../../src/lib/loopback-server", () => ({
  startLoopbackServer: vi.fn(async (opts: {expectedState: string; timeoutMs?: number}) => {
    state.loopback.started += 1;
    state.loopback.opts = opts;
    const make = state.loopback.result ?? (async () => ({code: "auth-code-1"}));
    return {port: state.loopback.port, result: make(), close: vi.fn()};
  })
}));

vi.mock("../../src/lib/browser", () => ({
  openBrowser: vi.fn(async (url: string) => {
    state.browser.urls.push(url);
    return state.browser.opens;
  })
}));

vi.mock("@inquirer/prompts", () => ({
  password: vi.fn(async () => "pasted-token-1234"),
  select: vi.fn(async () => "sandbox")
}));

import login from "../../src/commands/login";

let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;

const realStdinTty = process.stdin.isTTY;
const realStdoutTty = process.stdout.isTTY;

/**
 * Standard 2-response happy path: exchange → businesses.
 *
 * resolveBusiness no longer calls identity; it fetches the businesses list
 * (`GET /api/business/`, shape `{business: [{business:{id,status,businessInfo}}]}`)
 * and binds the grant's businessId (here biz_1).
 */
function queueSingleBusinessLogin(): void {
  state.httpResponses = [
    {
      data: {
        accessToken: "at-1",
        refreshToken: "rt-1",
        userId: "u_1",
        businessId: "biz_1",
        expiresIn: 3600,
        state: "test-state"
      }
    },
    {
      data: {
        business: [{business: {id: "biz_1", status: "ACTIVE", businessInfo: {legalBusinessName: "Acme Coffee"}}}]
      }
    }
  ];
}

function stdout(): string {
  return stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
}

function stderr(): string {
  return stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
}

beforeEach(() => {
  state.config = {};
  state.secrets = {};
  state.jwt = {};
  state.httpResponses = [];
  state.httpCalls = [];
  state.loopback = {port: 43210, started: 0, opts: undefined, result: undefined};
  state.browser = {urls: [], opens: true};
  state.activeBusinessCalls = [];
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  process.exitCode = undefined;
  // Browser login requires an interactive terminal; vitest isn't one.
  (process.stdin as unknown as {isTTY: boolean}).isTTY = true;
  (process.stdout as unknown as {isTTY: boolean}).isTTY = true;
});

afterEach(() => {
  (process.stdin as unknown as {isTTY: boolean | undefined}).isTTY = realStdinTty;
  (process.stdout as unknown as {isTTY: boolean | undefined}).isTTY = realStdoutTty;
  vi.restoreAllMocks();
});

describe("login (browser PKCE flow)", () => {
  it("opens a grant URL with all five params, exchanges the code, verifies state, and stores the JWT pair", async () => {
    queueSingleBusinessLogin();
    await (login.run as any)({args: {env: "sandbox"}, rawArgs: []});

    expect(process.exitCode).toBeUndefined();

    // Grant URL.
    expect(state.browser.urls).toHaveLength(1);
    const url = new URL(state.browser.urls[0]);
    expect(url.origin).toBe("https://dashboard.paywithatoa.co.uk");
    expect(url.pathname).toBe("/auth/extension-callback");
    expect(url.searchParams.get("source")).toBe("CLI");
    expect(url.searchParams.get("code_challenge")).toBe("test-challenge");
    expect(url.searchParams.get("state")).toBe("test-state");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:43210/callback");
    expect(url.searchParams.get("client_device_id")).toBe("device-uuid-1");
    expect(url.searchParams.get("device_name")).toBe("test-host");

    // Loopback server got the expected state before the browser opened.
    expect(state.loopback.opts).toMatchObject({expectedState: "test-state"});

    // Exchange: code + verifier, no Authorization header.
    expect(state.httpCalls[0]).toMatchObject({
      method: "POST",
      path: "/api/v1/auth/exchange",
      auth: "none",
      body: {code: "auth-code-1", codeVerifier: "test-verifier"}
    });

    // Businesses fetched over JWT (no identity call any more).
    expect(state.httpCalls[1]).toMatchObject({method: "GET", path: "/api/business/", auth: "jwt"});
    expect(state.httpCalls.map((c) => c.path)).not.toContain("/api/v1/identity");

    // Tokens stored under the derived profile (env-independent key); profile persisted with authMode jwt.
    expect(state.jwt["acme-coffee"]).toEqual({accessToken: "at-1", refreshToken: "rt-1"});
    const profile = (state.config.profiles as Record<string, {businessId: string; envs: Record<string, unknown>}>)[
      "acme-coffee"
    ];
    expect(profile.businessId).toBe("biz_1");
    expect(profile.envs.sandbox).toMatchObject({authMode: "jwt"});
    expect(state.config.activeProfile).toBe("acme-coffee");

    expect(stderr()).toMatch(/if it doesn't open, visit/i);
    expect(stdout()).toMatch(/logged in to sandbox as profile "acme-coffee"/);
    expect(stdout()).toMatch(/business: Acme Coffee/);
  });

  it("honours a runtime ATOA_DASHBOARD_URL override for the grant URL", async () => {
    process.env.ATOA_DASHBOARD_URL = "https://dashboard.atoa.dev";
    try {
      queueSingleBusinessLogin();
      await (login.run as any)({args: {env: "sandbox"}, rawArgs: []});
      expect(new URL(state.browser.urls[0]).origin).toBe("https://dashboard.atoa.dev");
    } finally {
      delete process.env.ATOA_DASHBOARD_URL;
    }
  });

  it("still completes when the browser cannot be opened, telling the user to open the URL manually", async () => {
    state.browser.opens = false;
    queueSingleBusinessLogin();
    await (login.run as any)({args: {env: "sandbox"}, rawArgs: []});
    expect(process.exitCode).toBeUndefined();
    expect(stderr()).toMatch(/open the URL above manually/i);
    expect(state.jwt["acme-coffee"]).toBeDefined();
  });

  it("aborts WITHOUT storing tokens when the exchange echoes a mismatched state", async () => {
    state.httpResponses = [{data: {accessToken: "at-1", refreshToken: "rt-1", userId: "u_1", state: "evil-state"}}];
    await (login.run as any)({args: {env: "sandbox"}, rawArgs: []});
    expect(process.exitCode).toBe(2); // auth
    expect(Object.keys(state.jwt)).toHaveLength(0);
    expect(Object.keys(state.secrets)).toHaveLength(0);
    expect(state.config.profiles).toBeUndefined();
    expect(stderr()).toMatch(/mismatched state/i);
  });

  it("exits cleanly with an auth error when the user declines in the browser — no exchange call is made", async () => {
    state.loopback.result = () =>
      Promise.reject(new Error("OAuth error: access_denied (user denied or provider error)"));
    await (login.run as any)({args: {env: "sandbox"}, rawArgs: []});
    expect(process.exitCode).toBe(2); // auth
    expect(state.httpCalls).toHaveLength(0);
    expect(Object.keys(state.jwt)).toHaveLength(0);
    expect(stderr()).toMatch(/Authorisation declined/);
  });

  it("reports a clear timeout message when no callback arrives", async () => {
    state.loopback.result = () =>
      Promise.reject(new Error("OAuth login timeout after 180000ms — no browser callback received"));
    await (login.run as any)({args: {env: "sandbox"}, rawArgs: []});
    expect(process.exitCode).toBe(2);
    expect(state.httpCalls).toHaveLength(0);
    expect(stderr()).toMatch(/Timed out waiting for the browser authorisation/);
  });

  it("multi-business (no grant businessId): prompts from the businesses list and persists the chosen one", async () => {
    // The grant carries NO businessId, and the list has >1 entry → resolveBusiness prompts.
    state.httpResponses = [
      {
        data: {accessToken: "at-1", refreshToken: "rt-1", userId: "u_1", expiresIn: 3600, state: "test-state"}
      },
      {
        data: {
          business: [
            {business: {id: "b1", status: "ACTIVE", businessInfo: {legalBusinessName: "Acme Coffee"}}},
            {business: {id: "b2", status: "ACTIVE", businessInfo: {legalBusinessName: "Beta Bakery"}}}
          ]
        }
      }
    ];
    const prompts = await import("@inquirer/prompts");
    (prompts.select as any).mockResolvedValueOnce("b2");

    await (login.run as any)({args: {env: "sandbox"}, rawArgs: []});

    expect(process.exitCode).toBeUndefined();
    expect(prompts.select).toHaveBeenCalledTimes(1);
    const choices = (prompts.select as any).mock.calls[0][0].choices;
    expect(choices).toEqual([
      {name: "Acme Coffee (b1)", value: "b1"},
      {name: "Beta Bakery (b2)", value: "b2"}
    ]);

    // exchange then a single businesses fetch — no identity call, no retry.
    const paths = state.httpCalls.map((c) => c.path);
    expect(paths).toEqual(["/api/v1/auth/exchange", "/api/business/"]);

    expect(state.activeBusinessCalls).toEqual([{profile: "beta-bakery", businessId: "b2"}]);
    expect(state.jwt["beta-bakery"]).toEqual({accessToken: "at-1", refreshToken: "rt-1"});
    expect(stdout()).toMatch(/business: Beta Bakery/);
  });

  it("multi-business without an interactive stdout: lists business ids, instructs `atoa business use`, defaults to the first", async () => {
    (process.stdout as unknown as {isTTY: boolean}).isTTY = false;
    state.httpResponses = [
      {data: {accessToken: "at-1", refreshToken: "rt-1", userId: "u_1", expiresIn: 3600, state: "test-state"}},
      {
        data: {
          business: [
            {business: {id: "b1", status: "ACTIVE", businessInfo: {legalBusinessName: "Acme Coffee"}}},
            {business: {id: "b2", status: "ACTIVE", businessInfo: {legalBusinessName: "Beta Bakery"}}}
          ]
        }
      }
    ];
    await (login.run as any)({args: {env: "sandbox"}, rawArgs: []});

    expect(process.exitCode).toBeUndefined();
    // Defaults to the first business and persists it (active business set to b1).
    expect(state.activeBusinessCalls).toEqual([{profile: "acme-coffee", businessId: "b1"}]);
    expect(state.jwt["acme-coffee"]).toBeDefined();
    expect(stderr()).toMatch(/b1 {2}Acme Coffee/);
    expect(stderr()).toMatch(/b2 {2}Beta Bakery/);
    expect(stderr()).toMatch(/atoa business use <id>/);
  });

  it("fails fast when stdin is not a TTY (browser login needs a terminal)", async () => {
    (process.stdin as unknown as {isTTY: boolean}).isTTY = false;
    await (login.run as any)({args: {env: "sandbox"}, rawArgs: []});

    expect(process.exitCode).toBe(3); // validation
    expect(state.loopback.started).toBe(0);
    expect(state.httpCalls).toHaveLength(0);
    expect(stderr()).toMatch(/interactive terminal/);
  });
});
