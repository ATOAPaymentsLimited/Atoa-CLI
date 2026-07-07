// BASE_URL / DASHBOARD_URL are injected at compile time by tsup
declare const BASE_URL: string | undefined;
declare const DASHBOARD_URL: string | undefined;

export type Env = "sandbox" | "production";

export const PUBLIC_BASE_URL = "https://api.atoa.me";
export const PUBLIC_DASHBOARD_URL = "https://dashboard.paywithatoa.co.uk";

export function parseEnvFlag(raw: string | undefined): Env {
  if (!raw || raw === "sandbox") return "sandbox";
  if (raw === "production" || raw === "prod") return "production";
  throw new Error(`--env must be sandbox or production, got: ${raw}`);
}

export function resolveBaseUrl(): string {
  const runtime = process.env.ATOA_BASE_URL?.trim();
  if (runtime) return runtime;
  return typeof BASE_URL === "string" ? BASE_URL : PUBLIC_BASE_URL;
}

/**
 * Dashboard origin for the browser-grant login page. Resolution order:
 * runtime `ATOA_DASHBOARD_URL` env var → compile-time DASHBOARD_URL define
 * (tsup) → production default.
 */
export function resolveDashboardUrl(): string {
  const runtime = process.env.ATOA_DASHBOARD_URL?.trim();
  if (runtime) return runtime;
  return typeof DASHBOARD_URL === "string" ? DASHBOARD_URL : PUBLIC_DASHBOARD_URL;
}

export function assertSecureBaseUrl(): void {
  assertHttps("BASE_URL", resolveBaseUrl());
}

/**
 * The dashboard origin carries the PKCE code_challenge, state, and loopback
 * redirect_uri in the browser-grant URL — an http:// dashboard sends the whole
 * authorization request in plaintext, so it gets the same https guard as BASE_URL.
 */
export function assertSecureDashboardUrl(): void {
  assertHttps("DASHBOARD_URL", resolveDashboardUrl());
}

const ALLOWED_HOSTS = ["atoa.me", "paywithatoa.co.uk"];
const ALLOWED_HOST_SUFFIXES = [".atoa.me", ".paywithatoa.co.uk"];

function isAllowedHost(url: string): boolean {
  try {
    if (isLoopbackHost(url)) return true;
    const {hostname} = new URL(url);
    return ALLOWED_HOSTS.includes(hostname) || ALLOWED_HOST_SUFFIXES.some((s) => hostname.endsWith(s));
  } catch {
    return false;
  }
}

function assertHttps(label: string, url: string): void {
  if (!url.startsWith("https://")) {
    if (process.env.ATOA_ALLOW_INSECURE === "1" && isLoopbackHost(url)) return;
    throw new Error(`Refusing to start: ${label}="${url}" must be https://. Rebuild with an https:// ${label}.`);
  }
  // https:// must additionally target an Atoa-controlled host (or loopback), so an overridden
  // BASE_URL/DASHBOARD_URL can't exfiltrate credentials to an arbitrary server. This also blocks
  // host tricks like "api.atoa.me@evil.example" (host=evil.example) and "...atoa.me.evil.example".
  if (!isAllowedHost(url)) {
    throw new Error(`Refusing to start: ${label}="${url}" host is not an Atoa domain`);
  }
}

function isLoopbackHost(raw: string): boolean {
  try {
    const {hostname} = new URL(raw);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}
