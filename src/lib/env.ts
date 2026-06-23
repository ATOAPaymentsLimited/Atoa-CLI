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
  const baseUrl = resolveBaseUrl();
  if (baseUrl.startsWith("https://")) return;

  // ponytail: dev escape hatch — plaintext http allowed only for localhost AND
  // only with an explicit opt-in. Remote http stays banned. Drop the env var to re-harden.
  if (process.env.ATOA_ALLOW_INSECURE === "1" && /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseUrl)) return;

  throw new Error(`Refusing to start: BASE_URL="${baseUrl}" must be https://. Rebuild with an https:// BASE_URL.`);
}
