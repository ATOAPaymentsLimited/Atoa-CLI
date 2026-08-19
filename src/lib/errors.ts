import {t} from "./i18n";

export type AtoaErrorKind =
  | "auth" // exit 2 — HTTP 401
  | "forbidden" // exit 2 — HTTP 403
  | "validation" // exit 3 — HTTP 400, 422
  | "not_found" // exit 4 — HTTP 404
  | "rate_limit" // exit 5 — HTTP 429
  | "network" // exit 6 — fetch reject / DNS / TLS
  | "business_selection" // exit 7 — HTTP 400 with businessIds[] (JWT user belongs to >1 business, none selected)
  | "plan_limit" // exit 8 — HTTP 403 ADDON_UPGRADE_REQUIRED (an addon-plan refusal, not an auth failure)
  | "generic"; // exit 1 — everything else

const EXIT_CODES: Record<AtoaErrorKind, number> = {
  auth: 2,
  forbidden: 2,
  validation: 3,
  not_found: 4,
  rate_limit: 5,
  network: 6,
  business_selection: 7,
  plan_limit: 8,
  generic: 1
};

/**
 * The backend's addon-upgrade-required error, as it arrives on the wire. Its error filter
 * puts the class's `name` into the body's `name` field, which mapHttpResponse reads as errorCode.
 */
export const ADDON_UPGRADE_REQUIRED = "ADDON_UPGRADE_REQUIRED";

export class AtoaError extends Error {
  kind: AtoaErrorKind;
  status?: number;
  errorCode?: string;
  requestId?: string;
  /** Backend `additionalData` payload, when present (e.g. CoP fuzzy match's {fuzzyName, registeredName}). */
  additionalData?: Record<string, unknown>;
  /** Secondary explanation printed under the headline (e.g. the addon's description). */
  detail?: string;

  constructor(
    message: string,
    kind: AtoaErrorKind,
    opts?: {
      status?: number;
      errorCode?: string;
      requestId?: string;
      additionalData?: Record<string, unknown>;
      detail?: string;
    }
  ) {
    super(message);
    this.name = "AtoaError";
    this.kind = kind;
    this.status = opts?.status;
    this.errorCode = opts?.errorCode;
    this.requestId = opts?.requestId;
    this.additionalData = opts?.additionalData;
    this.detail = opts?.detail;
  }
}

export function exitCodeFor(kind: AtoaErrorKind | undefined): number {
  return EXIT_CODES[kind ?? "generic"] ?? 1;
}

export function mapHttpResponse(status: number, body: unknown, requestId: string | undefined): AtoaError {
  let kind: AtoaErrorKind;
  if (status === 401) kind = "auth";
  else if (status === 403) kind = "forbidden";
  else if (status === 400 || status === 422) kind = "validation";
  else if (status === 404) kind = "not_found";
  else if (status === 429) kind = "rate_limit";
  else kind = "generic";

  const b = (body ?? {}) as Record<string, unknown>;
  const raw = (b["message"] ?? b["error"] ?? `HTTP ${status}`) as string;
  const message = typeof raw === "string" ? raw.slice(0, 200) : `HTTP ${status}`;
  // OTP throttling arrives with a 401/403 status even though it's really a "slow down" error
  // (e.g. "…maximum number of OTP requests…"). Reclassify by message so we neither tell the user
  // to re-authenticate nor exit with the auth code — it's a rate limit, cleared by waiting.
  if (/maximum number of otp requests|too many otp requests/i.test(message)) {
    kind = "rate_limit";
  }
  // Prefer an explicit errorCode; fall back to the backend's `name` field, which carries a
  // stable SCREAMING_SNAKE code (e.g. OTP_VERIFICATION_IS_REQUIRED) used to branch control flow.
  const codeRaw =
    typeof b["errorCode"] === "string" ? b["errorCode"] : typeof b["name"] === "string" ? b["name"] : undefined;
  const errorCode = codeRaw?.trim().slice(0, 64);
  const ad = b["additionalData"];
  const additionalData = ad && typeof ad === "object" ? (ad as Record<string, unknown>) : undefined;

  // An addon-plan refusal is served as 403, but re-authenticating can never clear it — leaving it
  // classified as "forbidden" made the CLI exit 2 and tell the user to run `atoa login`.
  if (errorCode === ADDON_UPGRADE_REQUIRED) kind = "plan_limit";

  // For that one case the useful headline is `title`; `message` carries the addon's marketing
  // description ("Manage multiple store locations efficiently…"), which reads as a sales pitch
  // rather than an error. Scoped to plan_limit deliberately: no other exception is known to set
  // `title`, and preferring it blindly would bury genuine messages behind generic headings.
  const titleRaw = b["title"];
  const title = typeof titleRaw === "string" ? titleRaw.trim().slice(0, 200) : "";
  const useTitle = kind === "plan_limit" && title.length > 0 && title !== message;

  return new AtoaError(useTitle ? title : message, kind, {
    status,
    errorCode,
    requestId,
    additionalData,
    detail: useTitle ? message : undefined
  });
}

function hintFor(err: AtoaError, authMode: "jwt" | "sdk"): string | undefined {
  // Checked ahead of the auth branch: this arrives as a 403, so without it the user is told to
  // re-authenticate for what is really "your plan doesn't allow that".
  if (err.errorCode === ADDON_UPGRADE_REQUIRED) {
    return t("hintAddonUpgrade");
  }
  if (err.kind === "auth" || err.kind === "forbidden") {
    // SDK-key commands authenticate with an API key, not a browser login — so don't
    // tell the user to `atoa login` there; point them at the key instead.
    return authMode === "sdk" ? t("hintSdkKeyInvalid") : t("hintReauthenticate");
  }
  return undefined;
}

export function printError(err: unknown, opts?: {authMode?: "jwt" | "sdk"}): void {
  // Ctrl-C at an interactive prompt: @inquirer throws ExitPromptError. That's a
  // user abort, not a failure — exit quietly without the scary SIGINT message.
  if (err instanceof Error && err.name === "ExitPromptError") return;

  if (err instanceof AtoaError) {
    if (err.kind === "network") {
      process.stderr.write(t("errorLine", {message: err.message}));
      return;
    }
    const hint = hintFor(err, opts?.authMode ?? "jwt");
    const parts = [
      hint ? t("errorWithHint", {message: err.message, hint}) : t("errorHeadline", {message: err.message})
    ];
    if (err.detail) parts.push(t("errorDetail", {detail: err.detail}));
    if (err.requestId) parts.push(t("errorRequestId", {requestId: err.requestId}));
    process.stderr.write(parts.join("\n") + "\n");
  } else if (err instanceof Error) {
    process.stderr.write(t("errorLine", {message: err.message}));
  } else {
    process.stderr.write(t("errorLine", {message: String(err)}));
  }
}
