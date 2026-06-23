export type AtoaErrorKind =
  | "auth" // exit 2 — HTTP 401
  | "forbidden" // exit 2 — HTTP 403
  | "validation" // exit 3 — HTTP 400, 422
  | "not_found" // exit 4 — HTTP 404
  | "rate_limit" // exit 5 — HTTP 429
  | "network" // exit 6 — fetch reject / DNS / TLS
  | "business_selection" // exit 7 — HTTP 400 with businessIds[] (JWT user belongs to >1 business, none selected)
  | "generic"; // exit 1 — everything else

const EXIT_CODES: Record<AtoaErrorKind, number> = {
  auth: 2,
  forbidden: 2,
  validation: 3,
  not_found: 4,
  rate_limit: 5,
  network: 6,
  business_selection: 7,
  generic: 1
};

export class AtoaError extends Error {
  kind: AtoaErrorKind;
  status?: number;
  errorCode?: string;
  requestId?: string;
  /** Backend `additionalData` payload, when present (e.g. CoP fuzzy match's {fuzzyName, registeredName}). */
  additionalData?: Record<string, unknown>;

  constructor(
    message: string,
    kind: AtoaErrorKind,
    opts?: {status?: number; errorCode?: string; requestId?: string; additionalData?: Record<string, unknown>}
  ) {
    super(message);
    this.name = "AtoaError";
    this.kind = kind;
    this.status = opts?.status;
    this.errorCode = opts?.errorCode;
    this.requestId = opts?.requestId;
    this.additionalData = opts?.additionalData;
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
  // Prefer an explicit errorCode; fall back to the backend's `name` field, which carries a
  // stable SCREAMING_SNAKE code (e.g. OTP_VERIFICATION_IS_REQUIRED) used to branch control flow.
  const codeRaw =
    typeof b["errorCode"] === "string" ? b["errorCode"] : typeof b["name"] === "string" ? b["name"] : undefined;
  const errorCode = codeRaw?.trim().slice(0, 64);
  const ad = b["additionalData"];
  const additionalData = ad && typeof ad === "object" ? (ad as Record<string, unknown>) : undefined;

  return new AtoaError(message, kind, {status, errorCode, requestId, additionalData});
}

function hintFor(err: AtoaError, authMode: "jwt" | "sdk"): string | undefined {
  if (err.kind === "auth" || err.kind === "forbidden") {
    // SDK-key commands authenticate with an API key, not a browser login — so don't
    // tell the user to `atoa login` there; point them at the key instead.
    return authMode === "sdk"
      ? "your Atoa API key may be invalid or revoked — run 'atoa keys create' to set a new one"
      : "run 'atoa login' to (re-)authenticate";
  }
  return undefined;
}

export function printError(err: unknown, opts?: {authMode?: "jwt" | "sdk"}): void {
  // Ctrl-C at an interactive prompt: @inquirer throws ExitPromptError. That's a
  // user abort, not a failure — exit quietly without the scary SIGINT message.
  if (err instanceof Error && err.name === "ExitPromptError") return;

  if (err instanceof AtoaError) {
    if (err.kind === "network") {
      process.stderr.write(`error: ${err.message}\n`);
      return;
    }
    const parts = [`error: ${err.message}`];
    const hint = hintFor(err, opts?.authMode ?? "jwt");
    if (hint) parts[0] += ` — ${hint}`;
    if (err.status) parts.push(`  status: ${err.status}`);
    if (err.errorCode) parts.push(`  code: ${err.errorCode}`);
    if (err.requestId) parts.push(`  request-id: ${err.requestId}`);
    process.stderr.write(parts.join("\n") + "\n");
  } else if (err instanceof Error) {
    process.stderr.write(`error: ${err.message}\n`);
  } else {
    process.stderr.write(`error: ${String(err)}\n`);
  }
}
