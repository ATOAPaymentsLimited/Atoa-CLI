import {Agent, fetch as undiciFetch} from "undici";
import {randomUUID} from "crypto";
import {mapHttpResponse, AtoaError} from "./errors";
import {redactAuthHeader} from "./auth";
import packageJson from "../../package.json";

export {assertTlsHardenedEnv} from "./bootstrap";

const TLS_CIPHERS = ["TLS_AES_256_GCM_SHA384", "TLS_CHACHA20_POLY1305_SHA256", "TLS_AES_128_GCM_SHA256"].join(":");

const CLI_VERSION = packageJson.version;
// User-Agent identifies CLI version + runtime to support diagnostics.
const USER_AGENT = `atoa-cli/${CLI_VERSION} (node ${process.version}; ${process.platform}-${process.arch})`;

export interface HttpClient {
  request(opts: {
    method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
    path: string;
    pathParams?: Record<string, string>;
    query?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
    headers?: Record<string, string>;
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

export function buildHttpClient(opts: {baseUrl: string; authHeader: string; verbose: boolean}): HttpClient {
  const agent = new Agent({
    connect: {
      minVersion: "TLSv1.3",
      ciphers: TLS_CIPHERS
    } as object,
    bodyTimeout: 30_000,
    headersTimeout: 30_000
  });

  async function request(
    reqOpts: Parameters<HttpClient["request"]>[0]
  ): Promise<{status: number; data: unknown; requestId: string}> {
    let path = reqOpts.path;
    if (reqOpts.pathParams) {
      for (const [k, v] of Object.entries(reqOpts.pathParams)) {
        path = path.replace(`:${k}`, encodeURIComponent(v));
      }
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

    const headers: Record<string, string> = {
      Authorization: opts.authHeader,
      Accept: "application/json",
      "User-Agent": USER_AGENT,
      "X-Cli-Version": CLI_VERSION,
      "X-Atoa-Cli-Request-Id": clientRequestId,
      ...reqOpts.headers
    };
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    if (reqOpts.body !== undefined) headers["Content-Type"] = "application/json";

    if (opts.verbose) {
      process.stderr.write(
        `> ${reqOpts.method} ${url.toString()}\n` + `> Authorization: ${redactAuthHeader(opts.authHeader)}\n`
      );
    }

    let response: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      try {
        response = await (undiciFetch as Function)(url.toString(), {
          method: reqOpts.method,
          headers,
          body: reqOpts.body !== undefined ? JSON.stringify(reqOpts.body) : undefined,
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

    if (!response.ok) {
      throw mapHttpResponse(response.status, data, requestId);
    }

    return {status: response.status, data, requestId};
  }

  return {request, baseUrl: opts.baseUrl};
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
