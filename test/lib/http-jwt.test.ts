import {describe, it, expect, beforeEach, vi} from "vitest";

// Hoisted mock of undici — same seam as http.test.ts. Every test stages
// `mockedFetch` to return a Response (or throw) and asserts on what
// `buildHttpClient` did with it.
const undiciMock = vi.hoisted(() => ({
  fetch: vi.fn(),
  // Regular function (not arrow) so production code can call `new Agent(...)` on it.
  Agent: vi.fn(function MockAgent() {
    return {};
  })
}));

vi.mock("undici", () => undiciMock);

// Imports MUST come after vi.mock so the production module sees the mocked undici.
import {buildHttpClient, type JwtSession, type JwtTokens} from "../../src/lib/http";
import {AtoaError, exitCodeFor} from "../../src/lib/errors";
import {V1_ROUTES} from "../../src/lib/v1-routes";

function jsonResponse(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {"content-type": "application/json", ...extraHeaders}
  });
}

/**
 * In-memory JwtSession double. Records setTokens/clearTokens calls so tests
 * can assert persistence without touching the real secrets store.
 */
function fakeJwtSession(opts: {tokens?: JwtTokens | null; activeBusinessId?: string} = {}): {
  session: JwtSession;
  setCalls: JwtTokens[];
  clearCalls: () => number;
  current: () => JwtTokens | null;
} {
  let tokens: JwtTokens | null =
    opts.tokens !== undefined ? opts.tokens : {accessToken: "jwt-access-1", refreshToken: "jwt-refresh-1"};
  const setCalls: JwtTokens[] = [];
  let cleared = 0;
  const session: JwtSession = {
    getTokens: async () => tokens,
    setTokens: async (t) => {
      tokens = t;
      setCalls.push(t);
    },
    clearTokens: async () => {
      tokens = null;
      cleared++;
    },
    getActiveBusinessId: async () => opts.activeBusinessId
  };
  return {session, setCalls, clearCalls: () => cleared, current: () => tokens};
}

function client(jwt?: JwtSession) {
  return buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer sdk-token", verbose: false, jwt});
}

function sentHeaders(callIndex: number): Record<string, string> {
  return undiciMock.fetch.mock.calls[callIndex][1].headers as Record<string, string>;
}

function sentUrl(callIndex: number): string {
  return undiciMock.fetch.mock.calls[callIndex][0] as string;
}

beforeEach(() => {
  undiciMock.fetch.mockReset();
  undiciMock.Agent.mockClear();
});

// ---------------------------------------------------------------------------
// sdk mode (the default) — regression: legacy SDK call sites are untouched
// ---------------------------------------------------------------------------

describe("auth mode resolution — sdk default", () => {
  it("a request without `auth` sends the SDK Authorization header, exactly as before", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(200, {ok: true}));
    const {session} = fakeJwtSession();
    await client(session).request({method: "GET", path: "/api/x"});

    expect(sentHeaders(0)["Authorization"]).toBe("Bearer sdk-token");
    expect(sentHeaders(0)["X-Atoa-Business"]).toBeUndefined();
  });

  it('explicit auth:"sdk" behaves identically', async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(200, {}));
    await client().request({method: "GET", path: "/api/x", auth: "sdk"});
    expect(sentHeaders(0)["Authorization"]).toBe("Bearer sdk-token");
  });
});

// ---------------------------------------------------------------------------
// jwt mode — bearer from the secrets store; businessId in the path, never a header
// ---------------------------------------------------------------------------

describe('auth: "jwt"', () => {
  it("attaches the stored JWT access token as the Bearer", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(200, {}));
    const {session} = fakeJwtSession();
    await client(session).request({method: "GET", path: "/api/user/profile/", auth: "jwt"});

    expect(sentHeaders(0)["Authorization"]).toBe("Bearer jwt-access-1");
  });

  it("auto-fills :businessId in the path from the active business (and sends NO business header)", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(200, {}));
    const {session} = fakeJwtSession({activeBusinessId: "biz-42"});
    await client(session).request({method: "GET", path: "/api/v1/businesses/:businessId/api-keys", auth: "jwt"});

    expect(sentUrl(0)).toBe("https://api.atoa.me/api/v1/businesses/biz-42/api-keys");
    expect(sentHeaders(0)["X-Atoa-Business"]).toBeUndefined();
  });

  it("an explicit businessId pathParam wins over the active business", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(200, {}));
    const {session} = fakeJwtSession({activeBusinessId: "biz-42"});
    await client(session).request({
      method: "GET",
      path: "/api/v1/businesses/:businessId/api-keys",
      auth: "jwt",
      pathParams: {businessId: "biz-99"}
    });

    expect(sentUrl(0)).toBe("https://api.atoa.me/api/v1/businesses/biz-99/api-keys");
  });

  it("leaves :businessId unfilled when no active business is set (no header either)", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(200, {}));
    const {session} = fakeJwtSession();
    await client(session).request({method: "GET", path: "/api/v1/businesses/:businessId/api-keys", auth: "jwt"});

    expect(sentUrl(0)).toBe("https://api.atoa.me/api/v1/businesses/:businessId/api-keys");
    expect(sentHeaders(0)["X-Atoa-Business"]).toBeUndefined();
  });

  it("keeps the shared request plumbing (UA, request id, Idempotency-Key) identical to sdk mode", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(200, {}));
    const {session} = fakeJwtSession();
    await client(session).request({method: "POST", path: "/api/v1/api-keys", auth: "jwt", body: {name: "ci"}});

    const headers = sentHeaders(0);
    expect(headers["User-Agent"]).toMatch(/^atoa-cli\//);
    expect(headers["X-Atoa-Cli-Request-Id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(headers["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("fails fast with an auth error and NO network call when no tokens are stored", async () => {
    const {session} = fakeJwtSession({tokens: null});
    const err = await client(session)
      .request({method: "GET", path: "/api/v1/identity", auth: "jwt"})
      .catch((e: AtoaError) => e);

    expect(err).toBeInstanceOf(AtoaError);
    expect((err as AtoaError).kind).toBe("auth");
    expect((err as AtoaError).message).toMatch(/atoa login/);
    expect(undiciMock.fetch).not.toHaveBeenCalled();
  });

  it("fails fast the same way when the client was built without a JwtSession", async () => {
    const err = await client()
      .request({method: "GET", path: "/api/v1/identity", auth: "jwt"})
      .catch((e: AtoaError) => e);

    expect((err as AtoaError).kind).toBe("auth");
    expect(undiciMock.fetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// none mode — auth exchange/refresh/revoke carry no Authorization
// ---------------------------------------------------------------------------

describe('auth: "none"', () => {
  it("sends no Authorization header", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(200, {}));
    const {session} = fakeJwtSession();
    await client(session).request({...V1_ROUTES.auth.exchange, body: {code: "c", codeVerifier: "v"}});

    expect(sentHeaders(0)["Authorization"]).toBeUndefined();
    expect(sentUrl(0)).toBe("https://api.atoa.me/api/auth/extension-token/exchange");
  });
});

// ---------------------------------------------------------------------------
// refresh-on-401 — exactly once, persisted, replayed
// ---------------------------------------------------------------------------

describe("jwt 401 → refresh → replay", () => {
  it("refreshes once, persists the new pair, and replays the original request with the new token", async () => {
    undiciMock.fetch
      .mockResolvedValueOnce(jsonResponse(401, {message: "expired"})) // original attempt
      .mockResolvedValueOnce(jsonResponse(200, {accessToken: "jwt-access-2", refreshToken: "jwt-refresh-2"})) // refresh
      .mockResolvedValueOnce(jsonResponse(200, {id: "me"})); // replay

    const jwt = fakeJwtSession();
    const res = await client(jwt.session).request({method: "GET", path: "/api/v1/identity", auth: "jwt"});

    expect(res.status).toBe(200);
    expect(undiciMock.fetch).toHaveBeenCalledTimes(3);

    // Call 0: original request with the old token.
    expect(sentUrl(0)).toBe("https://api.atoa.me/api/v1/identity");
    expect(sentHeaders(0)["Authorization"]).toBe("Bearer jwt-access-1");

    // Call 1: the refresh round-trip — auth "none", body {refreshToken}.
    expect(sentUrl(1)).toBe("https://api.atoa.me/api/auth/extension-token/refresh");
    expect(sentHeaders(1)["Authorization"]).toBeUndefined();
    expect(undiciMock.fetch.mock.calls[1][1].body).toBe(JSON.stringify({refreshToken: "jwt-refresh-1"}));

    // Call 2: replay of the original request with the refreshed token.
    expect(sentUrl(2)).toBe("https://api.atoa.me/api/v1/identity");
    expect(sentHeaders(2)["Authorization"]).toBe("Bearer jwt-access-2");

    // New pair persisted via the secrets-store seam.
    expect(jwt.setCalls).toEqual([{accessToken: "jwt-access-2", refreshToken: "jwt-refresh-2"}]);
  });

  it("the replay reuses the original Idempotency-Key (same logical write)", async () => {
    undiciMock.fetch
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(jsonResponse(200, {accessToken: "a2", refreshToken: "r2"}))
      .mockResolvedValueOnce(jsonResponse(200, {}));

    const jwt = fakeJwtSession();
    await client(jwt.session).request({method: "POST", path: "/api/v1/payments/links", auth: "jwt", body: {x: 1}});

    expect(sentHeaders(0)["Idempotency-Key"]).toBe(sentHeaders(2)["Idempotency-Key"]);
  });
});

describe("jwt refresh failure handling", () => {
  it("a 401 from the refresh endpoint clears the stored pair and reports the session as expired", async () => {
    undiciMock.fetch
      .mockResolvedValueOnce(jsonResponse(401, {})) // original
      .mockResolvedValueOnce(jsonResponse(401, {message: "refresh token revoked"})); // refresh fails

    const jwt = fakeJwtSession();
    const err = await client(jwt.session)
      .request({method: "GET", path: "/api/v1/identity", auth: "jwt"})
      .catch((e: AtoaError) => e);

    expect((err as AtoaError).kind).toBe("auth");
    expect((err as AtoaError).message).toMatch(/Session expired.*atoa login/);
    expect(jwt.clearCalls()).toBe(1);
    expect(jwt.current()).toBeNull();
    expect(undiciMock.fetch).toHaveBeenCalledTimes(2); // no replay after a failed refresh
  });

  it("a 400 from the refresh endpoint also clears the pair", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(401, {})).mockResolvedValueOnce(jsonResponse(400, {}));

    const jwt = fakeJwtSession();
    const err = await client(jwt.session)
      .request({method: "GET", path: "/api/v1/identity", auth: "jwt"})
      .catch((e: AtoaError) => e);

    expect((err as AtoaError).kind).toBe("auth");
    expect(jwt.clearCalls()).toBe(1);
  });

  it("a network failure during refresh keeps the stored pair (no destructive clear)", async () => {
    const netErr = new TypeError("fetch failed");
    (netErr as Error & {cause?: unknown}).cause = {code: "ECONNRESET", message: "reset"};
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(401, {})).mockRejectedValueOnce(netErr);

    const jwt = fakeJwtSession();
    const err = await client(jwt.session)
      .request({method: "GET", path: "/api/v1/identity", auth: "jwt"})
      .catch((e: AtoaError) => e);

    expect((err as AtoaError).kind).toBe("network");
    expect(jwt.clearCalls()).toBe(0);
    expect(jwt.current()).toEqual({accessToken: "jwt-access-1", refreshToken: "jwt-refresh-1"});
  });

  it("a second 401 on the replay surfaces as an auth error without a second refresh", async () => {
    undiciMock.fetch
      .mockResolvedValueOnce(jsonResponse(401, {})) // original
      .mockResolvedValueOnce(jsonResponse(200, {accessToken: "a2", refreshToken: "r2"})) // refresh OK
      .mockResolvedValueOnce(jsonResponse(401, {message: "still no"})); // replay 401s again

    const jwt = fakeJwtSession();
    const err = await client(jwt.session)
      .request({method: "GET", path: "/api/v1/identity", auth: "jwt"})
      .catch((e: AtoaError) => e);

    expect((err as AtoaError).kind).toBe("auth");
    expect(undiciMock.fetch).toHaveBeenCalledTimes(3); // original + ONE refresh + replay — never a 4th call
    const refreshCalls = undiciMock.fetch.mock.calls.filter((c) =>
      String(c[0]).includes("/auth/extension-token/refresh")
    );
    expect(refreshCalls).toHaveLength(1);
  });

  it("a 401 in sdk mode does NOT trigger a refresh (plain auth error, one call)", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(401, {message: "no"}));
    const jwt = fakeJwtSession();
    await expect(client(jwt.session).request({method: "GET", path: "/api/x"})).rejects.toMatchObject({kind: "auth"});
    expect(undiciMock.fetch).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Single-flight latch — concurrent 401s share ONE refresh round-trip
// ---------------------------------------------------------------------------

describe("jwt refresh single-flight", () => {
  it("two parallel 401s produce exactly one refresh; both requests replay and succeed", async () => {
    let refreshCount = 0;
    undiciMock.fetch.mockImplementation(async (url: string, init: {headers: Record<string, string>}) => {
      if (url.includes("/auth/extension-token/refresh")) {
        refreshCount++;
        // Hold the refresh open long enough for BOTH 401s to land on the latch.
        await new Promise((resolve) => setTimeout(resolve, 20));
        return jsonResponse(200, {accessToken: "jwt-access-2", refreshToken: "jwt-refresh-2"});
      }
      // Old token → 401; refreshed token → 200.
      if (init.headers["Authorization"] === "Bearer jwt-access-1") return jsonResponse(401, {});
      return jsonResponse(200, {ok: true});
    });

    const jwt = fakeJwtSession();
    const http = client(jwt.session);
    const [a, b] = await Promise.all([
      http.request({method: "GET", path: "/api/v1/identity", auth: "jwt"}),
      http.request({method: "GET", path: "/api/v1/businesses", auth: "jwt"})
    ]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(refreshCount).toBe(1);
    // 2 originals + 1 shared refresh + 2 replays = 5 fetches total.
    expect(undiciMock.fetch).toHaveBeenCalledTimes(5);
    // The pair was persisted once, not once per waiter.
    expect(jwt.setCalls).toEqual([{accessToken: "jwt-access-2", refreshToken: "jwt-refresh-2"}]);
  });

  it("the latch clears on settle: a later 401 can refresh again", async () => {
    undiciMock.fetch
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(jsonResponse(200, {accessToken: "a2", refreshToken: "r2"}))
      .mockResolvedValueOnce(jsonResponse(200, {}))
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(jsonResponse(200, {accessToken: "a3", refreshToken: "r3"}))
      .mockResolvedValueOnce(jsonResponse(200, {}));

    const jwt = fakeJwtSession();
    const http = client(jwt.session);
    await http.request({method: "GET", path: "/api/v1/identity", auth: "jwt"});
    await http.request({method: "GET", path: "/api/v1/identity", auth: "jwt"});

    const refreshCalls = undiciMock.fetch.mock.calls.filter((c) =>
      String(c[0]).includes("/auth/extension-token/refresh")
    );
    expect(refreshCalls).toHaveLength(2);
    expect(jwt.current()).toEqual({accessToken: "a3", refreshToken: "r3"});
  });
});

// ---------------------------------------------------------------------------
// business_selection — 400 with businessIds[] on a jwt request
// ---------------------------------------------------------------------------

describe("business selection (400 + businessIds[])", () => {
  it("maps a jwt 400 whose body lists businessIds to kind business_selection with guidance", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(400, {businessIds: ["biz-1", "biz-2"]}));
    const {session} = fakeJwtSession();

    const err = await client(session)
      .request({method: "GET", path: "/api/v1/stores", auth: "jwt"})
      .catch((e: AtoaError) => e);

    expect((err as AtoaError).kind).toBe("business_selection");
    expect((err as AtoaError).status).toBe(400);
    expect((err as AtoaError).message).toContain("biz-1");
    expect((err as AtoaError).message).toContain("biz-2");
    expect((err as AtoaError).message).toMatch(/atoa business use <id>/);
  });

  it("business_selection carries its own exit code, distinct from validation", () => {
    expect(exitCodeFor("business_selection")).toBe(7);
    expect(exitCodeFor("validation")).toBe(3);
  });

  it("a jwt 400 without businessIds stays kind validation", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(400, {message: "bad payload"}));
    const {session} = fakeJwtSession();
    await expect(
      client(session).request({method: "POST", path: "/api/v1/staff", auth: "jwt", body: {}})
    ).rejects.toMatchObject({
      kind: "validation",
      status: 400
    });
  });

  it("a jwt 400 with an empty or non-string businessIds array stays validation", async () => {
    undiciMock.fetch
      .mockResolvedValueOnce(jsonResponse(400, {businessIds: []}))
      .mockResolvedValueOnce(jsonResponse(400, {businessIds: [1, 2]}));
    const {session} = fakeJwtSession();
    const http = client(session);

    await expect(http.request({method: "GET", path: "/api/v1/stores", auth: "jwt"})).rejects.toMatchObject({
      kind: "validation"
    });
    await expect(http.request({method: "GET", path: "/api/v1/stores", auth: "jwt"})).rejects.toMatchObject({
      kind: "validation"
    });
  });

  it("an sdk 400 with businessIds stays validation (detection is jwt-only)", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(400, {businessIds: ["biz-1"]}));
    await expect(client().request({method: "GET", path: "/api/x"})).rejects.toMatchObject({kind: "validation"});
  });
});
