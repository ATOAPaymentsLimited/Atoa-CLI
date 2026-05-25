export type AtoaErrorKind =
  | "auth" // exit 2 — HTTP 401
  | "forbidden" // exit 2 — HTTP 403
  | "validation" // exit 3 — HTTP 400, 422
  | "not_found" // exit 4 — HTTP 404
  | "rate_limit" // exit 5 — HTTP 429
  | "network" // exit 6 — fetch reject / DNS / TLS
  | "generic"; // exit 1 — everything else

const EXIT_CODES: Record<AtoaErrorKind, number> = {
  auth: 2,
  forbidden: 2,
  validation: 3,
  not_found: 4,
  rate_limit: 5,
  network: 6,
  generic: 1
};

export class AtoaError extends Error {
  kind: AtoaErrorKind;
  status?: number;
  errorCode?: string;
  requestId?: string;

  constructor(message: string, kind: AtoaErrorKind, opts?: {status?: number; errorCode?: string; requestId?: string}) {
    super(message);
    this.name = "AtoaError";
    this.kind = kind;
    this.status = opts?.status;
    this.errorCode = opts?.errorCode;
    this.requestId = opts?.requestId;
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
  const errorCode = typeof b["errorCode"] === "string" ? b["errorCode"].slice(0, 64) : undefined;

  return new AtoaError(message, kind, {status, errorCode, requestId});
}

function hintFor(err: AtoaError): string | undefined {
  if (err.kind === "auth" || err.kind === "forbidden") {
    return "run 'atoa login' to (re-)authenticate";
  }
  return undefined;
}

export function printError(err: unknown): void {
  if (err instanceof AtoaError) {
    if (err.kind === "network") {
      process.stderr.write(`error: ${err.message}\n`);
      return;
    }
    const parts = [`error: ${err.message}`];
    const hint = hintFor(err);
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
