import {input} from "@inquirer/prompts";
import type {HttpClient} from "./http";
import type {V1Route} from "./v1-routes";
import {AtoaError} from "./errors";
import {BackendErrorCode} from "./enums";
import {t} from "./i18n";

/**
 * "OTP sent — resubmit the same body with `otp` populated". The backend i18n value carries a
 * trailing space; mapHttpResponse trims it, so this is what surfaces as errorCode. Status differs
 * by surface (onboarding 400, bank 401), so branch on the CODE, never the status.
 */
export const OTP_REQUIRED_CODE = BackendErrorCode.OTP_VERIFICATION_IS_REQUIRED;

export interface WithOtpOptions {
  /** Route for the first (no-otp) attempt. */
  send: V1Route;
  /** Route to resubmit with `otp`. Defaults to `send` (POST /v1/bank re-sends itself; onboarding verifies on a separate route). */
  verify?: V1Route;
  /** Request body. On the verify resubmit, `{...body, otp}` is sent. */
  body: Record<string, unknown>;
  /** Path params applied to both calls. */
  pathParams?: Record<string, string>;
  /**
   * Code supplied up front (`--otp`), skipping the prompt. Gets a single attempt: there is nobody
   * to retype it, so re-running the command is the caller's retry.
   */
  otp?: string;
  /** Max OTP entry attempts. Default 5 (matches the backend's OTP_MAX_WRONG_ATTEMPTS). */
  maxAttempts?: number;
  /**
   * Whether the caller may open a prompt — the command's own `isInteractive`, which also accounts
   * for `--output`. Falls back to stdin when unset, since a prompt at least needs that much.
   */
  interactive?: boolean;
  /** OTP prompt (overridable for tests). Default: @inquirer input. */
  promptOtp?: (message: string) => Promise<string>;
  /** Called once when the backend reports an OTP was sent (before prompting). */
  onOtpSent?: () => void;
  /**
   * Post-verify confirm hook. If the OTP-verified request itself fails (e.g. a CoP fuzzy-name
   * match), this is called with that error; returning a record of extra body fields re-sends the
   * verified request ONCE with them (keeping the same otp). Returning null gives up and rethrows.
   */
  resolveRetry?: (err: AtoaError) => Promise<Record<string, unknown> | null>;
}

/**
 * Runs a request that MAY require an OTP confirmation, transparently handling the
 * "send → verify" two-step. If the first attempt succeeds, no OTP was needed. If it
 * fails with errorCode OTP_VERIFICATION_IS_REQUIRED, prompts for the OTP and resubmits
 * the body (with `otp`) to `verify` up to `maxAttempts` times.
 *
 * Returns the successful response data and whether an OTP was actually required.
 */
export async function withOtp(http: HttpClient, opts: WithOtpOptions): Promise<{data: unknown; otpUsed: boolean}> {
  const verifyRoute = opts.verify ?? opts.send;
  const supplied = opts.otp?.trim();
  const maxAttempts = supplied ? 1 : (opts.maxAttempts ?? 5);
  const promptOtp = opts.promptOtp ?? ((message: string) => input({message}));

  // Skipped when a code was supplied: the probe request is what makes the backend SEND a code, so
  // running it would invalidate the one the caller is holding (and spend a send against the
  // per-minute allowance). With --otp we already know a code is required — submit it directly.
  if (!supplied) {
    // First attempt — no otp. Succeeds outright when the backend doesn't require one.
    // (When it raises 401, the http client refreshes-and-replays once before surfacing
    // the error — a harmless extra round-trip on the bank path.)
    try {
      const res = await http.request({...opts.send, pathParams: opts.pathParams, body: opts.body});
      return {data: res.data, otpUsed: false};
    } catch (err) {
      if ((err as AtoaError).errorCode !== OTP_REQUIRED_CODE) throw err;
    }

    opts.onOtpSent?.();
  }

  // Default prompt needs a terminal; a supplied code or a test-supplied promptOtp does not.
  // The send has already happened by this point, so the message names --otp: re-running with it
  // is the way through, and the code the caller just received is the one to use.
  //
  // The caller's own answer wins where it gave one: stdin alone says a code could be typed, not
  // that anyone would see the request for it — `--output json` in a terminal satisfies stdin and
  // still must exit 9 rather than prompt.
  const canPrompt = opts.interactive ?? Boolean(process.stdin.isTTY);
  if (!supplied && !opts.promptOtp && !canPrompt) {
    throw new AtoaError(t("otpRequiredPassFlag"), "otp_required");
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const otp = supplied || (await promptOtp(t("labelOtpAttempt", {attempt, max: maxAttempts})));
    try {
      const res = await http.request({...verifyRoute, pathParams: opts.pathParams, body: {...opts.body, otp}});
      return {data: res.data, otpUsed: true};
    } catch (err) {
      const ae = err as AtoaError;
      // The OTP itself verified but the request raised a resolvable error (e.g. a CoP fuzzy-name
      // match). Let the caller turn it into extra body fields and re-send once with the same otp.
      // resolveRetry returns null for errors it doesn't handle, which fall through to retry logic.
      if (!isThrottle(ae) && opts.resolveRetry) {
        const extra = await opts.resolveRetry(ae);
        if (extra) {
          const res = await http.request({
            ...verifyRoute,
            pathParams: opts.pathParams,
            body: {...opts.body, otp, ...extra}
          });
          return {data: res.data, otpUsed: true};
        }
      }
      if (retryableWrongCode(ae) && attempt < maxAttempts) {
        process.stderr.write(`${ae.message}\n`);
        continue;
      }
      throw asOtpFailure(ae, err);
    }
  }
  // Loop always returns or throws; this satisfies the type checker.
  throw new AtoaError("OTP verification failed.", "validation");
}

/** Keyed on kind, not status: the bank surface throttles with a 401, not a 429. */
const isThrottle = (ae: AtoaError): boolean => ae.kind === "rate_limit" || ae.status === 429;

/**
 * A code that another attempt could actually fix. Status differs by surface (onboarding answers
 * 400, the bank flow 401). Two exclusions: INVALID_CREDENTIAL is a dead access token, and expiry is
 * only raised for a code that MATCHED — retyping either re-fails identically.
 */
function retryableWrongCode(ae: AtoaError): boolean {
  if (isThrottle(ae) || ae.errorCode === BackendErrorCode.BANK_OTP_CODE_EXPIRED) return false;
  return ae.status === 400 || (ae.status === 401 && ae.errorCode !== BackendErrorCode.INVALID_CREDENTIAL);
}

/** Final classification once retrying is no longer an option. */
function asOtpFailure(ae: AtoaError, original: unknown): unknown {
  const opts = {status: ae.status, requestId: ae.requestId};
  if (isThrottle(ae)) {
    return new AtoaError(t("otpRateLimited", {message: ae.message ?? ""}), "rate_limit", opts);
  }
  if (ae.errorCode === BackendErrorCode.BANK_OTP_CODE_EXPIRED) {
    return new AtoaError(ae.message, "validation", opts);
  }
  if (retryableWrongCode(ae)) {
    return new AtoaError(ae.message || t("otpTooManyAttempts"), "validation", opts);
  }
  return original;
}
