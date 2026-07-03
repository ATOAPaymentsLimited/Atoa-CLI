/* eslint-disable complexity */
/* eslint-disable max-lines-per-function */
import {Agent, fetch as undiciFetch, FormData} from "undici";
import {randomUUID} from "crypto";
import {mapHttpResponse, AtoaError} from "./errors";
import {redactAuthHeader} from "./auth";
import {V1_ROUTES} from "./v1-routes";
import type {JwtTokens} from "./secrets-store";
import {lockLog} from "./secrets-store";
import packageJson from "../../package.json";

export {assertTlsHardenedEnv} from "./bootstrap";
export type {JwtTokens};

const TLS_CIPHERS = ["TLS_AES_256_GCM_SHA384", "TLS_CHACHA20_POLY1305_SHA256", "TLS_AES_128_GCM_SHA256"].join(":");

const CLI_VERSION = packageJson.version;
// User-Agent identifies CLI version + runtime to support diagnostics.
const USER_AGENT = `atoa-cli/${CLI_VERSION} (node ${process.version}; ${process.platform}-${process.arch})`;

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

/**
 * Which credential a request is sent with:
 * - "sdk"  — the long-lived SDK access token passed at client construction
 *            (the default; every legacy SDK call site keeps this behaviour).
 * - "jwt"  — the short-lived JWT from the secrets store; the active business
 *            is carried in the route path (:businessId), never a header.
 * - "none" — no Authorization header (auth exchange/refresh/revoke).
 */
export type AuthMode = "sdk" | "jwt" | "none";

/**
 * Seam the HTTP layer uses to read/persist the JWT credential pair without
 * coupling to the secrets/config stores. Wired up in buildContext.
 */
export interface JwtSession {
  getTokens(): Promise<JwtTokens | null>;
  setTokens(tokens: JwtTokens): Promise<void>;
  clearTokens(): Promise<void>;
  getActiveBusinessId(): Promise<string | undefined>;
}

export interface HttpClient {
  request(opts: {
    method: HttpMethod;
    path: string;
    pathParams?: Record<string, string>;
    query?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
    /**
     * Raw request body sent as-is (e.g. multipart FormData for file uploads). When set, the
     * body is NOT JSON-stringified and no application/json Content-Type is forced — undici sets
     * the correct (multipart boundary) header itself. Takes precedence over `body`.
     */
    rawBody?: FormData;
    headers?: Record<string, string>;
    /** Credential to attach. Defaults to "sdk" so existing call sites are untouched. */
    auth?: AuthMode;
    /**
     * Override the auto-generated Idempotency-Key (only used on POST/PUT/PATCH).
     * Omit on writes to get a fresh UUIDv4 per call — that's the safe default
     * and is what every payment endpoint needs to prevent duplicates on retry.
     */
    idempotencyKey?: string;
  }): Promise<{status: number; data: unknown; requestId: string}>;
  baseUrl: string;
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH"]);

export function buildHttpClient(opts: {
  baseUrl: string;
  authHeader: string;
  verbose: boolean;
  jwt?: JwtSession;
}): HttpClient {
  // Single-flight latch for the JWT refresh round-trip. Per-client (closure-scoped),
  // not module-level: each client refreshes through its OWN `opts.jwt` seam, so two
  // clients that 401 concurrently can never coalesce onto each other's refresh and
  // write tokens through the wrong seam. Cleared on settle so a later expiry refreshes
  // again. (Also keeps tests isolated — one client's refresh can't leak into another's.)
  let jwtRefreshInFlight: Promise<void> | null = null;

  const agent = new Agent({
    connect: {
      minVersion: "TLSv1.3",
      ciphers: TLS_CIPHERS
    } as object,
    bodyTimeout: 30_000,
    headersTimeout: 30_000
  });

  /**
   * Resolves the auth-dependent headers for one attempt. For "jwt" the access
   * token is re-read per attempt so a refresh between attempts is picked up.
   * Fails fast (before any network I/O) when JWT credentials are missing.
   */
  async function resolveAuthHeaders(mode: AuthMode): Promise<{headers: Record<string, string>; logValue?: string}> {
    if (mode === "sdk") return {headers: {Authorization: opts.authHeader}, logValue: opts.authHeader};
    if (mode === "none") return {headers: {}};

    const jwt = opts.jwt;
    const tokens = jwt ? await jwt.getTokens() : null;
    if (!jwt || !tokens) {
      throw new AtoaError("Not logged in for this profile — run `atoa login` to authenticate.", "auth");
    }
    // businessId is NOT sent as a header — every business-scoped route carries it in the path
    // (`:businessId`, auto-filled in send() from jwt.getActiveBusinessId).
    const headers: Record<string, string> = {Authorization: `Bearer ${tokens.accessToken}`};
    return {headers, logValue: headers["Authorization"]};
  }

  async function send(
    reqOpts: Parameters<HttpClient["request"]>[0],
    mode: AuthMode,
    allowRefresh: boolean
  ): Promise<{status: number; data: unknown; requestId: string}> {
    let path = reqOpts.path;
    const pathParams: Record<string, string> = {...reqOpts.pathParams};
    // Auto-fill :businessId from the active profile — the same source as the X-Atoa-Business
    // header (jwt.getActiveBusinessId). These endpoints take the business in the path, so
    // this lets every command stay business-agnostic without threading
    // the id through each call site (mirrors how the header was injected centrally).
    if (mode === "jwt" && path.includes(":businessId") && pathParams.businessId === undefined && opts.jwt) {
      const activeBusinessId = await opts.jwt.getActiveBusinessId();
      if (activeBusinessId) pathParams.businessId = activeBusinessId;
    }
    for (const [k, v] of Object.entries(pathParams)) {
      path = path.replace(`:${k}`, encodeURIComponent(v));
    }

    const url = new URL(opts.baseUrl + path);
    if (reqOpts.query) {
      for (const [k, v] of Object.entries(reqOpts.query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }

    // Client-generated correlation id. Always present so we have something to
    // show the user even on transport failures. When the response includes an
    // x-request-id header we prefer that value (it's the one to quote when
    // contacting support).
    const clientRequestId = randomUUID();

    // Idempotency-Key auto-generated on writes unless caller overrides. The CLI
    // can't safely retry payment writes without it: a network blip after the
    // server commits but before it responds would otherwise produce a duplicate
    // charge / refund / payment-request on retry. Override path is for callers
    // who key off something stable (e.g. `$RUN_ID` in CI dedup).
    const idempotencyKey = reqOpts.idempotencyKey ?? (WRITE_METHODS.has(reqOpts.method) ? randomUUID() : undefined);

    const auth = await resolveAuthHeaders(mode);
    const headers: Record<string, string> = {
      ...auth.headers,
      Accept: "application/json",
      "User-Agent": USER_AGENT,
      "X-Cli-Version": CLI_VERSION,
      "X-Atoa-Cli-Request-Id": clientRequestId,
      ...reqOpts.headers
    };
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    // Raw (multipart) bodies set their own Content-Type via undici; only force JSON otherwise.
    if (reqOpts.rawBody === undefined && reqOpts.body !== undefined) headers["Content-Type"] = "application/json";

    if (opts.verbose) {
      process.stderr.write(
        `> ${reqOpts.method} ${url.toString()}\n` + `> Authorization: ${redactAuthHeader(auth.logValue)}\n`
      );
    }

    let response: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      try {
        response = await (undiciFetch as typeof undiciFetch)(url.toString(), {
          method: reqOpts.method,
          headers,
          body: reqOpts.rawBody ?? (reqOpts.body !== undefined ? JSON.stringify(reqOpts.body) : undefined),
          dispatcher: agent,
          signal: controller.signal
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        throw new AtoaError("Request timed out after 30s", "network", {requestId: clientRequestId});
      }
      throw new AtoaError(describeFetchError(err, url.toString()), "network", {requestId: clientRequestId});
    }

    // Prefer the response's x-request-id when present (that's the one support
    // will ask for); fall back to our client-generated id so a requestId is
    // ALWAYS available.
    const requestId = response.headers.get("x-request-id") ?? clientRequestId;

    const ct = response.headers.get("content-type") ?? "";
    const raw = await response.text();
    let data: unknown = undefined;
    if (raw.length > 0) {
      data = ct.includes("application/json") ? JSON.parse(raw) : raw;
    }

    // Access tokens last ~1h: a 401 on a JWT request means "expired", so refresh once and
    // replay. `allowRefresh` is false on the replay itself — a second 401 surfaces as a plain
    // auth error instead of looping.
    //
    // CONTRACT — why replaying a write is safe: (1) the backend returns 401 BEFORE running
    // business logic (auth is rejected pre-processing), so the 401'd attempt had no side effect;
    // and (2) writes (POST/PUT/PATCH) carry the SAME Idempotency-Key on the replay, so even if
    // (1) were ever violated the backend dedups the duplicate. DELETE is naturally idempotent.
    // The only unsafe case is a backend that 401s AFTER a partial mutation AND ignores the
    // Idempotency-Key — revisit this replay if that ever becomes possible.
    if (response.status === 401 && mode === "jwt" && allowRefresh) {
      await refreshJwtTokens();
      // Reuse the (possibly auto-generated) Idempotency-Key — the replay is the same logical write.
      return send({...reqOpts, idempotencyKey}, mode, false);
    }

    if (!response.ok) {
      if (mode === "jwt" && response.status === 400) {
        const businessIds = extractBusinessIds(data);
        if (businessIds) {
          throw new AtoaError(
            `This account belongs to multiple businesses: ${businessIds.join(", ")}. ` +
              "Select one with `atoa business use <id>`.",
            "business_selection",
            {status: response.status, requestId}
          );
        }
      }
      throw mapHttpResponse(response.status, data, requestId);
    }

    return {status: response.status, data, requestId};
  }

  /** Single-flight wrapper: concurrent 401s share one refresh round-trip. */
  function refreshJwtTokens(): Promise<void> {
    if (!jwtRefreshInFlight) {
      jwtRefreshInFlight = performJwtRefresh().finally(() => {
        jwtRefreshInFlight = null;
      });
    }
    return jwtRefreshInFlight;
  }

  async function performJwtRefresh(): Promise<void> {
    // Only reachable from a "jwt" request, which already required the session + tokens.
    const jwt = opts.jwt;
    const tokens = jwt ? await jwt.getTokens() : null;
    if (!jwt || !tokens) throw new AtoaError("Session expired — run `atoa login`", "auth");

    let refreshed: {status: number; data: unknown; requestId: string};
    try {
      const {method, path} = V1_ROUTES.auth.refresh;
      refreshed = await send({method, path, body: {refreshToken: tokens.refreshToken}}, "none", false);
    } catch (err) {
      // 400/401 from the refresh endpoint = the refresh token itself is dead.
      // Clear the pair so we don't keep retrying garbage; anything else
      // (network, 5xx) keeps the tokens and surfaces as-is.
      if (err instanceof AtoaError && (err.status === 400 || err.status === 401)) {
        await jwt.clearTokens();
        throw new AtoaError("Session expired — run `atoa login`", "auth", {
          status: err.status,
          requestId: err.requestId
        });
      }
      throw err;
    }

    const d = refreshed.data as {accessToken?: unknown; refreshToken?: unknown} | undefined;
    if (typeof d?.accessToken !== "string" || typeof d?.refreshToken !== "string") {
      throw new AtoaError("Token refresh returned an unexpected response — run `atoa login`", "auth", {
        requestId: refreshed.requestId
      });
    }
    lockLog("http: 401 refresh succeeded — persisting rotated tokens (this write creates session.lock)");
    await jwt.setTokens({accessToken: d.accessToken, refreshToken: d.refreshToken});
  }

  async function request(
    reqOpts: Parameters<HttpClient["request"]>[0]
  ): Promise<{status: number; data: unknown; requestId: string}> {
    const mode = reqOpts.auth ?? "sdk";
    return send(reqOpts, mode, mode === "jwt");
  }

  return {request, baseUrl: opts.baseUrl};
}

/**
 * The backend's "you belong to >1 business and didn't pick one" 400 carries a
 * `businessIds: string[]` body field. Detect it strictly so ordinary
 * validation 400s never get misclassified.
 */
function extractBusinessIds(body: unknown): string[] | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const ids = (body as Record<string, unknown>)["businessIds"];
  if (!Array.isArray(ids) || ids.length === 0) return undefined;
  if (!ids.every((v) => typeof v === "string")) return undefined;
  return ids as string[];
}

function describeFetchError(err: unknown, url: string): string {
  const e = err as {message?: string; cause?: {code?: string; message?: string; errno?: string}};
  const cause = e?.cause;
  const code = cause?.code ?? cause?.errno;
  const causeMsg = cause?.message;
  const baseMsg = e?.message ?? "request failed";
  const host = safeHost(url);

  switch (code) {
    case "ECONNREFUSED":
      return `connection refused at ${host} — is the server running and reachable?`;
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return `DNS lookup failed for ${host} (${code}) — check the host name and your network`;
    case "ETIMEDOUT":
      return `connection timed out to ${host}`;
    case "ECONNRESET":
      return `connection reset by ${host} — the server may have closed the socket mid-request`;
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return `host unreachable: ${host} (${code})`;
    case "CERT_HAS_EXPIRED":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "SELF_SIGNED_CERT_IN_CHAIN":
      return `TLS verification failed for ${host} (${code})`;
    default:
      if (causeMsg) return `${baseMsg}: ${causeMsg}${code ? ` (${code})` : ""}`;
      return code ? `${baseMsg} (${code})` : baseMsg;
  }
}

function safeHost(url: string): string {
  try {
    const u = new URL(url);
    return u.host;
  } catch {
    return url;
  }
}
