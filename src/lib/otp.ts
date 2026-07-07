import {input} from "@inquirer/prompts";
import type {HttpClient} from "./http";
import type {V1Route} from "./v1-routes";
import {AtoaError} from "./errors";

/**
 * Stable backend code signalling "OTP sent — resubmit the same body with `otp` populated".
 * The backend i18n value carries a trailing space ("OTP_VERIFICATION_IS_REQUIRED "); the http
 * layer's mapHttpResponse already trims it, so this exact string is what surfaces as errorCode.
 *
 * NOTE the status differs by surface: onboarding raises it as 400, the bank flow as 401
 * (CustomUnauthorized). We therefore branch on the CODE, never the status.
 */
export const OTP_REQUIRED_CODE = "OTP_VERIFICATION_IS_REQUIRED";

export interface WithOtpOptions {
  /** Route for the first (no-otp) attempt. */
  send: V1Route;
  /** Route to resubmit with `otp`. Defaults to `send` (POST /v1/bank re-sends itself; onboarding verifies on a separate route). */
  verify?: V1Route;
  /** Request body. On the verify resubmit, `{...body, otp}` is sent. */
  body: Record<string, unknown>;
  /** Path params applied to both calls. */
  pathParams?: Record<string, string>;
  /** Max OTP entry attempts. Default 5 (matches the backend's OTP_MAX_WRONG_ATTEMPTS). */
  maxAttempts?: number;
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
  const maxAttempts = opts.maxAttempts ?? 5;
  const promptOtp = opts.promptOtp ?? ((message: string) => input({message}));

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

  // Default prompt needs a terminal; a test-supplied promptOtp does not.
  if (!opts.promptOtp && !process.stdin.isTTY) {
    throw new AtoaError("An OTP is required to continue, but no interactive terminal is available.", "validation");
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const otp = await promptOtp(`OTP (attempt ${attempt}/${maxAttempts}):`);
    try {
      const res = await http.request({...verifyRoute, pathParams: opts.pathParams, body: {...opts.body, otp}});
      return {data: res.data, otpUsed: true};
    } catch (err) {
      const ae = err as AtoaError;
      if (ae.status === 429) {
        throw new AtoaError(
          `OTP rate limit reached${ae.message ? ": " + ae.message : ""}. Please wait before trying again.`,
          "rate_limit",
          {status: ae.status, requestId: ae.requestId}
        );
      }
      // The OTP itself verified but the request raised a resolvable error (e.g. a CoP fuzzy-name
      // match — which may also be a 400). Let the caller turn it into extra body fields and re-send
      // once with the same otp. resolveRetry returns null for errors it doesn't handle (including a
      // genuine wrong-OTP 400), which then falls through to the OTP-retry logic below.
      if (opts.resolveRetry) {
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
      // 400 = wrong/expired OTP — retry while attempts remain, otherwise give up. The backend
      // supplies the precise reason + remaining count (wrong code / expired / N left), so surface it.
      if (ae.status === 400 && attempt < maxAttempts) {
        process.stderr.write(`${ae.message}\n`);
        continue;
      }
      if (ae.status === 400) {
        throw new AtoaError(ae.message || "Too many incorrect OTP attempts.", "validation", {
          status: ae.status,
          requestId: ae.requestId
        });
      }
      throw err;
    }
  }
  // Loop always returns or throws; this satisfies the type checker.
  throw new AtoaError("OTP verification failed.", "validation");
}
