import {describe, it, expect, beforeEach, vi} from "vitest";

/**
 * A profile whose businessId was never written — the state `signup` leaves behind when it
 * creates the account but is interrupted before a business exists. The session is still valid,
 * so the business is looked up and written back rather than the user being sent to log in again.
 */
const store = vi.hoisted(() => ({
  profiles: {} as Record<string, any>,
  written: [] as Array<{name: string; profile: any}>,
  jwt: {accessToken: "a", refreshToken: "r"} as unknown
}));

const httpMock = vi.hoisted(() => ({
  requests: [] as Array<{method: string; path: string}>,
  businesses: [] as unknown[],
  fail: false
}));

vi.mock("../../src/lib/config-store", async () => {
  const actual = await vi.importActual<any>("../../src/lib/config-store");
  return {
    ...actual,
    reconcileConfig: vi.fn(async () => undefined),
    resolveActiveProfile: vi.fn(async () => ({kind: "ok", name: "acme", profile: store.profiles["acme"]})),
    readProfile: vi.fn(async (name: string) => store.profiles[name]),
    writeProfile: vi.fn(async (name: string, patch: any) => {
      store.profiles[name] = {...store.profiles[name], ...patch};
      store.written.push({name, profile: store.profiles[name]});
    }),
    getActiveBusinessId: vi.fn(async (name: string) => store.profiles[name]?.activeBusinessId)
  };
});

vi.mock("../../src/lib/secrets-store", () => ({
  createSecretsStore: async () => ({
    getJwtTokens: async () => store.jwt,
    setJwtTokens: async () => undefined,
    clearJwtTokens: async () => undefined
  })
}));

vi.mock("../../src/lib/http", async () => {
  const actual = await vi.importActual<any>("../../src/lib/http");
  return {
    ...actual,
    assertTlsHardenedEnv: () => undefined,
    buildHttpClient: () => ({
      baseUrl: "https://api.example",
      request: async (req: any) => {
        httpMock.requests.push({method: req.method, path: req.path});
        if (httpMock.fail) throw new Error("network down");
        return {status: 200, data: {business: httpMock.businesses}, requestId: "r"};
      }
    })
  };
});

import {buildContext} from "../../src/lib/context";

const businessRow = (id: string, name: string) => ({
  business: {id, status: "APPROVED", businessInfo: {legalBusinessName: name}}
});

beforeEach(() => {
  store.profiles = {acme: {businessId: "", displayName: "acme@example.com", envs: {}}};
  store.written = [];
  store.jwt = {accessToken: "a", refreshToken: "r"};
  httpMock.requests = [];
  httpMock.businesses = [];
  httpMock.fail = false;
});

describe("buildContext — incomplete profile", () => {
  it("adopts the account's only business and persists it", async () => {
    httpMock.businesses = [businessRow("biz_1", "Acme Ltd")];
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    const ctx = await buildContext({});

    expect(httpMock.requests.map((r) => r.path)).toContain("/api/business/");
    expect(ctx.profile.businessId).toBe("biz_1");
    // Persisted, so the lookup happens once rather than on every command.
    expect(store.written[0].profile).toMatchObject({businessId: "biz_1", activeBusinessId: "biz_1"});
    stderr.mockRestore();
  });

  it("refuses to guess when the account has several businesses", async () => {
    httpMock.businesses = [businessRow("biz_1", "Acme Ltd"), businessRow("biz_2", "Acme Trading")];

    await expect(buildContext({})).rejects.toMatchObject({kind: "business_selection"});
    expect(store.written).toHaveLength(0);
  });

  it("points at signup when the account has no business at all", async () => {
    httpMock.businesses = [];
    await expect(buildContext({})).rejects.toMatchObject({kind: "validation"});
  });

  it("reports a network failure as such, not as a broken profile", async () => {
    httpMock.fail = true;
    await expect(buildContext({})).rejects.toMatchObject({kind: "network"});
  });

  it("does not look anything up when the profile is already complete", async () => {
    store.profiles = {acme: {businessId: "biz_9", activeBusinessId: "biz_9", displayName: "Acme", envs: {}}};
    const ctx = await buildContext({});
    expect(httpMock.requests).toHaveLength(0);
    expect(ctx.profile.businessId).toBe("biz_9");
  });

  it("leaves the profile alone when the caller allows an incomplete one (signup)", async () => {
    const ctx = await buildContext({}, {allowIncomplete: true});
    expect(httpMock.requests).toHaveLength(0);
    expect(ctx.profile.businessId).toBe("");
  });
});
