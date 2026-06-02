// BASE_URL is injected at compile time by tsup
declare const BASE_URL: string | undefined;

export type Env = "sandbox" | "production";

export const PUBLIC_BASE_URL = "https://api.atoa.me";

export function parseEnvFlag(raw: string | undefined): Env {
  if (!raw || raw === "sandbox") return "sandbox";
  if (raw === "production" || raw === "prod") return "production";
  throw new Error(`--env must be sandbox or production, got: ${raw}`);
}

export function resolveBaseUrl(): string {
  return typeof BASE_URL === "string" ? BASE_URL : PUBLIC_BASE_URL;
}

export function assertSecureBaseUrl(): void {
  const baseUrl = resolveBaseUrl();
  if (baseUrl.startsWith("https://")) return;

  throw new Error(`Refusing to start: BASE_URL="${baseUrl}" must be https://. Rebuild with an https:// BASE_URL.`);
}
