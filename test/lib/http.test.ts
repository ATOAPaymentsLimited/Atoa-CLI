import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";

// Hoisted mock of undici. Every test stages `mockedFetch` to return a Response
// (or throw) and asserts on what `buildHttpClient` did with it.
const undiciMock = vi.hoisted(() => ({
  fetch: vi.fn(),
  // Regular function (not arrow) so production code can call `new Agent(...)` on it.
  Agent: vi.fn(function MockAgent() {
    return {};
  })
}));

vi.mock("undici", () => undiciMock);

// Imports MUST come after vi.mock so the production module sees the mocked undici.
import {assertTlsHardenedEnv, buildHttpClient} from "../../src/lib/http";
import {AtoaError} from "../../src/lib/errors";

function jsonResponse(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {"content-type": "application/json", ...extraHeaders}
  });
}

function emptyResponse(status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response("", {status, headers: extraHeaders});
}

function plainTextResponse(status: number, body: string, extraHeaders: Record<string, string> = {}): Response {
  return new Response(body, {status, headers: {"content-type": "text/plain", ...extraHeaders}});
}

beforeEach(() => {
  undiciMock.fetch.mockReset();
  undiciMock.Agent.mockClear();
});

// ---------------------------------------------------------------------------
// TLS env-var guard (re-exported from bootstrap.ts) — kept for back-compat
// ---------------------------------------------------------------------------

describe("assertTlsHardenedEnv (re-exported from bootstrap)", () => {
  afterEach(() => {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  });

  it("throws when NODE_TLS_REJECT_UNAUTHORIZED=0", () => {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    expect(() => assertTlsHardenedEnv()).toThrow(/certificate validation/);
  });

  it("does not throw when the variable is unset", () => {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    expect(() => assertTlsHardenedEnv()).not.toThrow();
  });

  it("does not throw when set to a value other than 0", () => {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1";
    expect(() => assertTlsHardenedEnv()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Request target confinement — a path must not rewrite the host
// ---------------------------------------------------------------------------

describe("buildHttpClient — off-origin request confinement", () => {
  it("rejects a path that rewrites the host, and never calls fetch", async () => {
    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    await expect(client.request({method: "GET", path: "@evil.example/steal"})).rejects.toThrow(/off-origin/);
    await expect(client.request({method: "GET", path: ".evil.example/steal"})).rejects.toThrow(/off-origin/);
    expect(undiciMock.fetch).not.toHaveBeenCalled();
  });

  it("allows a normal absolute path on the configured origin", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(200, {ok: true}));
    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    const res = await client.request({method: "GET", path: "/v1/thing"});
    expect(res.status).toBe(200);
    expect(undiciMock.fetch).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Default headers — User-Agent, X-Cli-Version, Authorization, Accept
// ---------------------------------------------------------------------------

describe("buildHttpClient — default headers on every request", () => {
  it("sends the Authorization header passed at construction time", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(200, {ok: true}));

    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer abc123", verbose: false});
    await client.request({method: "GET", path: "/api/x"});

    const headers = undiciMock.fetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer abc123");
  });

  it("sends Accept: application/json", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(200, {}));
    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    await client.request({method: "GET", path: "/api/x"});
    const headers = undiciMock.fetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["Accept"]).toBe("application/json");
  });

  it("sends a User-Agent that includes atoa-cli, the version, node version, and platform", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(200, {}));
    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    await client.request({method: "GET", path: "/api/x"});

    const headers = undiciMock.fetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/^atoa-cli\/\d+\.\d+\.\d+ \(node v?\d+\.\d+\.\d+; \w+-\w+\)$/);
  });

  it("sends X-Cli-Version equal to the package version", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(200, {}));
    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    await client.request({method: "GET", path: "/api/x"});

    const headers = undiciMock.fetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["X-Cli-Version"]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("adds Content-Type: application/json only when a body is present", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(200, {})).mockResolvedValueOnce(jsonResponse(200, {}));

    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});

    await client.request({method: "GET", path: "/api/x"});
    let headers = undiciMock.fetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();

    await client.request({method: "POST", path: "/api/x", body: {a: 1}});
    headers = undiciMock.fetch.mock.calls[1][1].headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("allows caller-supplied headers to override or extend defaults", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(200, {}));
    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    await client.request({method: "GET", path: "/api/x", headers: {"X-Trace": "abc", "User-Agent": "test/1"}});
    const headers = undiciMock.fetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["X-Trace"]).toBe("abc");
    expect(headers["User-Agent"]).toBe("test/1"); // caller wins
  });

  it("sends a UUIDv4 X-Atoa-Cli-Request-Id on every request", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(200, {})).mockResolvedValueOnce(jsonResponse(200, {}));

    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    await client.request({method: "GET", path: "/api/x"});
    await client.request({method: "GET", path: "/api/x"});

    const h1 = undiciMock.fetch.mock.calls[0][1].headers as Record<string, string>;
    const h2 = undiciMock.fetch.mock.calls[1][1].headers as Record<string, string>;
    const uuidv4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(h1["X-Atoa-Cli-Request-Id"]).toMatch(uuidv4);
    expect(h2["X-Atoa-Cli-Request-Id"]).toMatch(uuidv4);
    expect(h1["X-Atoa-Cli-Request-Id"]).not.toBe(h2["X-Atoa-Cli-Request-Id"]); // fresh per request
  });
});

// ---------------------------------------------------------------------------
// Idempotency-Key — auto-generated on writes, overridable
// ---------------------------------------------------------------------------

describe("buildHttpClient — Idempotency-Key", () => {
  const uuidv4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it.each(["POST", "PUT", "PATCH"] as const)("auto-generates a UUIDv4 Idempotency-Key on %s", async (method) => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(200, {}));
    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    await client.request({method, path: "/api/x", body: {a: 1}});
    const headers = undiciMock.fetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toMatch(uuidv4);
  });

  it.each(["GET", "DELETE"] as const)("does NOT auto-generate Idempotency-Key on %s", async (method) => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(200, {}));
    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    await client.request({method, path: "/api/x"});
    const headers = undiciMock.fetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBeUndefined();
  });

  it("auto-generated key differs across two calls (fresh UUID per request)", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(200, {})).mockResolvedValueOnce(jsonResponse(200, {}));

    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    await client.request({method: "POST", path: "/api/x", body: {}});
    await client.request({method: "POST", path: "/api/x", body: {}});

    const k1 = (undiciMock.fetch.mock.calls[0][1].headers as Record<string, string>)["Idempotency-Key"];
    const k2 = (undiciMock.fetch.mock.calls[1][1].headers as Record<string, string>)["Idempotency-Key"];
    expect(k1).not.toBe(k2);
  });

  it("caller-supplied idempotencyKey overrides auto-generation", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(200, {}));
    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    await client.request({method: "POST", path: "/api/x", body: {}, idempotencyKey: "RUN_42"});
    const headers = undiciMock.fetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("RUN_42");
  });

  it("caller-supplied idempotencyKey applies even on GET (operator override)", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(200, {}));
    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    await client.request({method: "GET", path: "/api/x", idempotencyKey: "k"});
    const headers = undiciMock.fetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("k");
  });
});

// ---------------------------------------------------------------------------
// Request-Id fallback — client-id used when server returns no x-request-id
// ---------------------------------------------------------------------------

describe("buildHttpClient — requestId resolution", () => {
  it("prefers server's x-request-id header when present", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(200, {}, {"x-request-id": "server-abc"}));

    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    const res = await client.request({method: "GET", path: "/api/x"});
    expect(res.requestId).toBe("server-abc");
  });

  it("falls back to client-generated X-Atoa-Cli-Request-Id when server returns none", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(200, {}));

    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    const res = await client.request({method: "GET", path: "/api/x"});

    const sent = (undiciMock.fetch.mock.calls[0][1].headers as Record<string, string>)["X-Atoa-Cli-Request-Id"];
    expect(res.requestId).toBe(sent);
  });
});

// ---------------------------------------------------------------------------
// Path + query construction
// ---------------------------------------------------------------------------

describe("buildHttpClient — URL composition", () => {
  it("prepends baseUrl + path", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(200, {}));
    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    await client.request({method: "GET", path: "/api/payments/transactions"});
    expect(undiciMock.fetch.mock.calls[0][0]).toBe("https://api.atoa.me/api/payments/transactions");
  });

  it("substitutes :pathParam placeholders with URL-encoded values", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(200, {}));
    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    await client.request({method: "GET", path: "/api/x/:id", pathParams: {id: "abc 123"}});
    expect(undiciMock.fetch.mock.calls[0][0]).toBe("https://api.atoa.me/api/x/abc%20123");
  });

  it("serializes query params and omits undefined values", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(200, {}));
    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    await client.request({
      method: "GET",
      path: "/api/x",
      query: {page: 0, size: 20, skipMe: undefined, flag: true}
    });
    const url = new URL(undiciMock.fetch.mock.calls[0][0] as string);
    expect(url.searchParams.get("page")).toBe("0");
    expect(url.searchParams.get("size")).toBe("20");
    expect(url.searchParams.get("flag")).toBe("true");
    expect(url.searchParams.get("skipMe")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Body serialization
// ---------------------------------------------------------------------------

describe("buildHttpClient — body", () => {
  it("JSON-stringifies the body when present", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(200, {}));
    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    await client.request({method: "POST", path: "/api/x", body: {amount: 1005, orderId: "o-1"}});
    expect(undiciMock.fetch.mock.calls[0][1].body).toBe(JSON.stringify({amount: 1005, orderId: "o-1"}));
  });

  it("omits the body when none is supplied", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(200, {}));
    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    await client.request({method: "GET", path: "/api/x"});
    expect(undiciMock.fetch.mock.calls[0][1].body).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Response handling: parse + x-request-id capture + empty body
// ---------------------------------------------------------------------------

describe("buildHttpClient — response handling", () => {
  it("parses JSON when Content-Type indicates application/json", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(200, {hello: "world"}));
    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    const {data, status} = await client.request({method: "GET", path: "/api/x"});
    expect(status).toBe(200);
    expect(data).toEqual({hello: "world"});
  });

  it("returns the raw text body when Content-Type is not JSON", async () => {
    undiciMock.fetch.mockResolvedValueOnce(plainTextResponse(200, "hello there"));
    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    const {data} = await client.request({method: "GET", path: "/api/x"});
    expect(data).toBe("hello there");
  });

  it("handles empty-body 200 responses (e.g. DELETE) without throwing", async () => {
    undiciMock.fetch.mockResolvedValueOnce(emptyResponse(200));
    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    const {data, status} = await client.request({method: "DELETE", path: "/api/x"});
    expect(status).toBe(200);
    expect(data).toBeUndefined();
  });

  it("captures x-request-id from the response headers", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(200, {}, {"x-request-id": "abc123def456"}));
    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    const {requestId} = await client.request({method: "GET", path: "/api/x"});
    expect(requestId).toBe("abc123def456");
  });

  it("falls back to the client-generated X-Atoa-Cli-Request-Id when server didn't send x-request-id", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(200, {}));
    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    const {requestId} = await client.request({method: "GET", path: "/api/x"});
    const sent = (undiciMock.fetch.mock.calls[0][1].headers as Record<string, string>)["X-Atoa-Cli-Request-Id"];
    expect(requestId).toBe(sent);
    expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

// ---------------------------------------------------------------------------
// HTTP error mapping — exit codes / AtoaError kinds
// ---------------------------------------------------------------------------

describe("buildHttpClient — HTTP error mapping", () => {
  it("maps 401 → AtoaError(auth)", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(401, {message: "no auth"}));
    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    await expect(client.request({method: "GET", path: "/api/x"})).rejects.toMatchObject({
      kind: "auth",
      status: 401
    });
  });

  it("maps 403 → AtoaError(forbidden)", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(403, {message: "denied"}));
    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    await expect(client.request({method: "GET", path: "/api/x"})).rejects.toMatchObject({
      kind: "forbidden",
      status: 403
    });
  });

  it("maps 400 → AtoaError(validation)", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(400, {message: "bad request"}));
    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    await expect(client.request({method: "POST", path: "/api/x", body: {}})).rejects.toMatchObject({
      kind: "validation",
      status: 400
    });
  });

  it("maps 422 → AtoaError(validation)", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(422, {message: "unprocessable"}));
    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    await expect(client.request({method: "POST", path: "/api/x"})).rejects.toMatchObject({
      kind: "validation",
      status: 422
    });
  });

  it("maps 404 → AtoaError(not_found)", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(404, {message: "missing"}));
    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    await expect(client.request({method: "GET", path: "/api/x"})).rejects.toMatchObject({
      kind: "not_found",
      status: 404
    });
  });

  it("maps 429 → AtoaError(rate_limit)", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(429, {message: "slow down"}));
    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    await expect(client.request({method: "GET", path: "/api/x"})).rejects.toMatchObject({
      kind: "rate_limit",
      status: 429
    });
  });

  it("maps 5xx → AtoaError(generic)", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(503, {message: "service unavailable"}));
    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    await expect(client.request({method: "GET", path: "/api/x"})).rejects.toMatchObject({
      kind: "generic",
      status: 503
    });
  });

  it("propagates the server's x-request-id onto the AtoaError so support can correlate", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(401, {message: "no auth"}, {"x-request-id": "srv-uuid-1"}));
    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    await expect(client.request({method: "GET", path: "/api/x"})).rejects.toMatchObject({
      requestId: "srv-uuid-1"
    });
  });
});

// ---------------------------------------------------------------------------
// Network-level error translation (describeFetchError branches)
// ---------------------------------------------------------------------------

function fetchError(code: string, message = "fetch failed"): Error {
  const err = new TypeError(message);
  (err as Error & {cause?: unknown}).cause = {code, message: `underlying: ${code}`};
  return err;
}

describe("buildHttpClient — network errors (AtoaError(network))", () => {
  it("translates ECONNREFUSED → connection refused (network kind + host in message)", async () => {
    undiciMock.fetch.mockRejectedValueOnce(fetchError("ECONNREFUSED"));
    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});

    const err = await client.request({method: "GET", path: "/api/x"}).catch((e: AtoaError) => e);
    expect(err).toBeInstanceOf(AtoaError);
    expect((err as AtoaError).kind).toBe("network");
    expect((err as AtoaError).message).toMatch(/connection refused at api\.atoa\.me/);
  });

  it("translates ENOTFOUND → DNS lookup failed", async () => {
    undiciMock.fetch.mockRejectedValueOnce(fetchError("ENOTFOUND"));
    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    await expect(client.request({method: "GET", path: "/api/x"})).rejects.toThrow(/DNS lookup failed/);
  });

  it("translates ETIMEDOUT → connection timed out", async () => {
    undiciMock.fetch.mockRejectedValueOnce(fetchError("ETIMEDOUT"));
    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    await expect(client.request({method: "GET", path: "/api/x"})).rejects.toThrow(/connection timed out/);
  });

  it("translates CERT_HAS_EXPIRED → TLS verification failed", async () => {
    undiciMock.fetch.mockRejectedValueOnce(fetchError("CERT_HAS_EXPIRED"));
    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    await expect(client.request({method: "GET", path: "/api/x"})).rejects.toThrow(/TLS verification failed/);
  });

  it("falls back to the raw cause message when the code is unknown", async () => {
    undiciMock.fetch.mockRejectedValueOnce(fetchError("WHO_KNOWS", "outer message"));
    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    await expect(client.request({method: "GET", path: "/api/x"})).rejects.toThrow(/WHO_KNOWS/);
  });

  it("AbortError (request timed out after 30s) maps to its own clear message", async () => {
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    undiciMock.fetch.mockRejectedValueOnce(abortErr);
    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    await expect(client.request({method: "GET", path: "/api/x"})).rejects.toThrow(/Request timed out after 30s/);
  });

  it("network errors carry the client-generated requestId for support correlation", async () => {
    undiciMock.fetch.mockRejectedValueOnce(fetchError("ECONNREFUSED"));
    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    await expect(client.request({method: "GET", path: "/api/x"})).rejects.toMatchObject({
      kind: "network",
      requestId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    });
  });
});

// ---------------------------------------------------------------------------
// --verbose request logging
// ---------------------------------------------------------------------------

describe("buildHttpClient — verbose mode", () => {
  it("prints the method, URL, and redacted Authorization to stderr", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(200, {}));
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer abcXYZ1234", verbose: true});
    await client.request({method: "GET", path: "/api/x"});

    const logged = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(logged).toContain("> GET https://api.atoa.me/api/x");
    expect(logged).toMatch(/Authorization: Bearer \[REDACTED…1234\]/);
    // Crucially: NO raw token in the log
    expect(logged).not.toContain("abcXYZ1234");

    stderrSpy.mockRestore();
  });

  it("does NOT log when verbose is false", async () => {
    undiciMock.fetch.mockResolvedValueOnce(jsonResponse(200, {}));
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    await client.request({method: "GET", path: "/api/x"});

    expect(stderrSpy).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Agent + timeout setup
// ---------------------------------------------------------------------------

describe("buildHttpClient — TLS-hardened Agent", () => {
  it("constructs a new Agent per client with TLS 1.3 minimum + 30s timeouts", () => {
    buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    expect(undiciMock.Agent).toHaveBeenCalledTimes(1);

    const cfg = (undiciMock.Agent.mock.calls[0] as unknown[])[0] as {
      connect?: {minVersion?: string; ciphers?: string};
      bodyTimeout?: number;
      headersTimeout?: number;
    };
    expect(cfg.connect?.minVersion).toBe("TLSv1.3");
    expect(cfg.connect?.ciphers).toMatch(/TLS_AES_256_GCM_SHA384/);
    expect(cfg.bodyTimeout).toBe(30_000);
    expect(cfg.headersTimeout).toBe(30_000);
  });
});

// ---------------------------------------------------------------------------
// Exposed baseUrl
// ---------------------------------------------------------------------------

describe("HttpClient — baseUrl property", () => {
  it("exposes the baseUrl it was constructed with", () => {
    const client = buildHttpClient({baseUrl: "https://api.atoa.me", authHeader: "Bearer x", verbose: false});
    expect(client.baseUrl).toBe("https://api.atoa.me");
  });
});
