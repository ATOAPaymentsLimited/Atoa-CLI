import {t} from "./i18n";
import {ACCESS_DENIED_CODES, BackendErrorCode, GENERIC_BAD_REQUEST, OTP_THROTTLE_CODES} from "./enums";

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

/** A backend code is SCREAMING_SNAKE; a class name like `HttpException` is not, and isn't one. */
const CODE_SHAPE = /^[A-Z][A-Z0-9_]*$/;

/**
 * Any code marker present on the body, unfiltered. The API carries one in `errorCode`, `name` or
 * `customName` depending on the endpoint — some error bodies omit `name` entirely and carry only
 * `customName`, so without the third a coded OTP throttle would look uncoded.
 *
 * Use this, not errorCodeOf, wherever absence is what grants permission: the 401 replay guard is
 * deny-by-default, so a marker it fails to see becomes a request it re-sends.
 */
export function rawErrorCodeOf(body: unknown): string | undefined {
  return codeMarkersOf(body)[0];
}

/** Every code-shaped field present, in descending order of trust. */
function codeMarkersOf(body: unknown): string[] {
  if (typeof body !== "object" || body === null) return [];
  const b = body as Record<string, unknown>;
  return [b["errorCode"], b["name"], b["customName"]]
    .filter((v): v is string => typeof v === "string" && v.trim() !== "")
    .map((v) => v.trim().slice(0, 64));
}

/**
 * The same field narrowed to codes that actually mean something. `BAD_REQUEST` is substituted
 * whenever the API wraps an error that had no code, and some bodies carry an exception class name
 * instead — both assert a specificity that isn't real, so for classification they are worse than
 * nothing.
 */
export function errorCodeOf(body: unknown): string | undefined {
  // Scans all three rather than narrowing whichever came first: a body carrying both a class name
  // and a real code would otherwise be judged by the class name and fall through to the wording.
  return codeMarkersOf(body).find((c) => c !== GENERIC_BAD_REQUEST && CODE_SHAPE.test(c));
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
  const errorCode = errorCodeOf(b);

  // Both OTP throttles — too many sends, and too many wrong codes — are a "slow down", not an auth
  // failure, and neither is cleared by retyping. Both arms are needed: the bank surface tags them
  // with a code, every other surface throws a bare 400 whose only marker is the wording.
  if (
    (errorCode && OTP_THROTTLE_CODES.includes(errorCode)) ||
    /maximum number of otp requests|too many otp requests|incorrect code too many times|maximum number of attempts reached|too many failed attempts/i.test(
      message
    )
  ) {
    kind = "rate_limit";
  }
  const ad = b["additionalData"];
  const additionalData = ad && typeof ad === "object" ? (ad as Record<string, unknown>) : undefined;

  // An addon-plan refusal is served as 403, but re-authenticating can never clear it — leaving it
  // classified as "forbidden" made the CLI exit 2 and tell the user to run `atoa login`.
  if (errorCode === ADDON_UPGRADE_REQUIRED) kind = "plan_limit";

  // Same trap on the 401s: these three refuse the access, not the credential.
  if (errorCode && ACCESS_DENIED_CODES.includes(errorCode)) kind = "forbidden";

  // For that one case the useful headline is `title`; `message` carries the addon's marketing
  // description ("Manage multiple store locations efficiently…"), which reads as a sales pitch
  // rather than an error. Scoped to plan_limit deliberately: no other exception is known to set
  // `title`, and preferring it blindly would bury genuine messages behind generic headings.
  const titleRaw = b["title"];
  const title = typeof titleRaw === "string" ? titleRaw.trim().slice(0, 200) : "";
  const useTitle = kind === "plan_limit" && title.length > 0 && title !== message;

  // The KYB refusal instead puts the merchant status (PENDING/IN_REVIEW/KYB_HOLD) in `title` —
  // which stage is blocking is the one thing its fixed message doesn't say.
  const kybStatus = errorCode === BackendErrorCode.KYB_VERIFICATION_REQUIRED && title ? title : undefined;
  const detail = useTitle ? message : kybStatus ? t("kybBusinessStatus", {status: kybStatus}) : undefined;

  return new AtoaError(useTitle ? title : message, kind, {status, errorCode, requestId, additionalData, detail});
}

function hintFor(err: AtoaError, authMode: "jwt" | "sdk"): string | undefined {
  // Checked ahead of the auth branch: this arrives as a 403, so without it the user is told to
  // re-authenticate for what is really "your plan doesn't allow that".
  if (err.errorCode === ADDON_UPGRADE_REQUIRED) {
    return t("hintAddonUpgrade");
  }
  if (err.errorCode === BackendErrorCode.UNAUTHORIZED_ACCESS) return t("hintCliRouteNotEnabled");
  if (err.errorCode === BackendErrorCode.KYB_VERIFICATION_REQUIRED) return t("hintKybVerify");
  // ROLE_UNAUTHORIZED_ACCESS names its own remedy ("request access from the Owner or Admin"),
  // so anything added here would only argue with it.
  if (err.errorCode === BackendErrorCode.ROLE_UNAUTHORIZED_ACCESS) return undefined;
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
