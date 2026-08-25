// Values the backend defines. Only what crosses the wire belongs here — TypeScript union
// discriminants (`AtoaErrorKind`, `OutputFormat`) are already checked by the compiler.

/** Merchant/KYB verification status. */
export const MerchantStatus = {
  PENDING: "PENDING",
  IN_REVIEW: "IN_REVIEW",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  KYB_HOLD: "KYB_HOLD"
} as const;
export type MerchantStatus = (typeof MerchantStatus)[keyof typeof MerchantStatus];

/** Not-submitted KYB states. The card-signup page gates on this same set — keep them in step. */
export const KYB_NOT_SUBMITTED: readonly MerchantStatus[] = [MerchantStatus.PENDING, MerchantStatus.REJECTED];

/** Everything short of APPROVED. Add-on upgrades are refused until verification passes. */
export const KYB_NOT_APPROVED: readonly MerchantStatus[] = [
  MerchantStatus.PENDING,
  MerchantStatus.IN_REVIEW,
  MerchantStatus.REJECTED,
  MerchantStatus.KYB_HOLD
];

/** NOT_INITIATED is synthesised client-side: the backend 404s rather than returning a status. */
export const CardApplicationStatus = {
  NOT_INITIATED: "NOT_INITIATED"
} as const;

/** Error codes the CLI branches on. The backend sends these in the body's `name`/`errorCode`. */
export const BackendErrorCode = {
  ADDON_UPGRADE_REQUIRED: "ADDON_UPGRADE_REQUIRED",
  COP_VERIFIED_WITH_FUZZY_MATCH: "COP_VERIFIED_WITH_FUZZY_MATCH",
  OTP_VERIFICATION_IS_REQUIRED: "OTP_VERIFICATION_IS_REQUIRED",
  /** Too many codes requested in an hour. Its backend copy says "incorrect code" — that copy is wrong. */
  BANK_OTP_LIMIT_REACH: "BANK_OTP_LIMIT_REACH",
  /** Too many wrong codes entered — the hour-long block a new code cannot clear. */
  BANK_OTP_VERIFICATION_LIMIT_REACH: "BANK_OTP_VERIFICATION_LIMIT_REACH",
  BANK_OTP_ONE_MINUTE_LIMIT_REACH: "BANK_OTP_ONE_MINUTE_LIMIT_REACH",
  /** The access token itself is bad or expired — the one 401 a token refresh can actually clear. */
  INVALID_CREDENTIAL: "INVALID_CREDENTIAL",
  /** Valid credentials, but this endpoint hasn't opted CLI tokens in. A new login mints the same token. */
  UNAUTHORIZED_ACCESS: "UNAUTHORIZED_ACCESS",
  /** The signed-in user's role lacks the permission; only an Owner or Admin can grant it. */
  ROLE_UNAUTHORIZED_ACCESS: "ROLE_UNAUTHORIZED_ACCESS",
  /** Business is not KYB-approved. Its `title` carries the merchant status. */
  KYB_VERIFICATION_REQUIRED: "KYB_VERIFICATION_REQUIRED",
  /** Sign-in locked after repeated failures. Carries retryAfterSeconds in additionalData. */
  AUTHENTICATION_COOLDOWN: "AUTHENTICATION_COOLDOWN",
  /** Wrong code, attempts still remaining — the one OTP failure a retype can actually fix. */
  BANK_INCORRECT_OTP: "BANK_INCORRECT_OTP",
  /** The code timed out. Retyping it cannot help; a fresh one must be requested. */
  BANK_OTP_CODE_EXPIRED: "BANK_OTP_CODE_EXPIRED"
} as const;
export type BackendErrorCode = (typeof BackendErrorCode)[keyof typeof BackendErrorCode];

/**
 * Refusals of access, not of credentials — a fresh login produces an identical refusal, because the
 * credential is valid and the path is not permitted. They arrive as 401/403, so without this they
 * read as "your session died" and the CLI advised `atoa login` in a loop that could never terminate.
 */
export const ACCESS_DENIED_CODES: readonly string[] = [
  BackendErrorCode.UNAUTHORIZED_ACCESS,
  BackendErrorCode.ROLE_UNAUTHORIZED_ACCESS,
  BackendErrorCode.KYB_VERIFICATION_REQUIRED
];

/**
 * Not a code, despite arriving in the code field. It is substituted whenever the API wraps an error
 * that had none, so accepting it asserts a specificity that isn't there — and it is exactly what the
 * non-bank OTP throttle arrives tagged with.
 */
export const GENERIC_BAD_REQUEST = "BAD_REQUEST";

/**
 * OTP throttles, which are "wait" not "you're unauthenticated". The bank surface tags them with a
 * code (and answers 401); every other surface throws a bare 400 whose only marker is the wording,
 * so the message match in mapHttpResponse is load-bearing, not belt-and-braces.
 */
/**
 * OTP outcomes that answer 401 but say nothing about the session — the code was wrong, expired, or
 * simply not supplied yet. withOtp intercepts these, so they reach the printer only from a caller
 * that isn't OTP-aware; left as auth they would tell the user to sign in over a mistyped code.
 */
export const OTP_DOMAIN_CODES: readonly string[] = [
  BackendErrorCode.OTP_VERIFICATION_IS_REQUIRED,
  BackendErrorCode.BANK_INCORRECT_OTP,
  BackendErrorCode.BANK_OTP_CODE_EXPIRED
];

/**
 * "Wait, then retry" — not "you're unauthenticated", though they arrive as 401. Covers both OTP
 * throttles and the sign-in cooldown, which is a lockout after repeated failed attempts rather than
 * anything to do with OTP; hence the general name.
 */
export const RATE_LIMITED_CODES: readonly string[] = [
  BackendErrorCode.BANK_OTP_LIMIT_REACH,
  BackendErrorCode.BANK_OTP_VERIFICATION_LIMIT_REACH,
  BackendErrorCode.BANK_OTP_ONE_MINUTE_LIMIT_REACH,
  BackendErrorCode.AUTHENTICATION_COOLDOWN
];

/** Addon features whose limits the plan controls. */
export const AddonFeatureType = {
  MULTI_STORE: "MULTI_STORE",
  MULTI_BANK_ACCOUNT: "MULTI_BANK_ACCOUNT",
  CUSTOM_ROLES: "CUSTOM_ROLES"
} as const;
export type AddonFeatureType = (typeof AddonFeatureType)[keyof typeof AddonFeatureType];

/** Notification channels a topic can be delivered on. */
export const CommsChannel = {
  EMAIL: "EMAIL",
  SMS: "SMS",
  PUSH: "PUSH"
} as const;
export type CommsChannel = (typeof CommsChannel)[keyof typeof CommsChannel];

/** Direct Debit mandate status, as Stripe reports it. */
export const MandateStatus = {
  ACTIVE: "active",
  PENDING: "pending",
  INACTIVE: "inactive"
} as const;
export type MandateStatus = (typeof MandateStatus)[keyof typeof MandateStatus];

/** How a channel toggle is written and read on the command line. */
export const Toggle = {
  ON: "on",
  OFF: "off"
} as const;
export type Toggle = (typeof Toggle)[keyof typeof Toggle];
