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

/** NOT_INITIATED is synthesised client-side: the backend 404s rather than returning a status. */
export const CardApplicationStatus = {
  NOT_INITIATED: "NOT_INITIATED"
} as const;

/** Error codes the CLI branches on. The backend sends these in the body's `name`/`errorCode`. */
export const BackendErrorCode = {
  ADDON_UPGRADE_REQUIRED: "ADDON_UPGRADE_REQUIRED",
  COP_VERIFIED_WITH_FUZZY_MATCH: "COP_VERIFIED_WITH_FUZZY_MATCH"
} as const;
export type BackendErrorCode = (typeof BackendErrorCode)[keyof typeof BackendErrorCode];

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
