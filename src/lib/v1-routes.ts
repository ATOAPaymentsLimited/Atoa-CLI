import type {AuthMode, HttpMethod} from "./http";

/**
 * Declarative route table for the CLI's backend calls.
 *
 * Two surfaces (BUD-019 teardown, 2026-06-18):
 *  - A small **programmatic-only /v1 facade** that has no merchant-app equivalent:
 *    auth token lifecycle, device `sessions`, CLI-scoped `apiKeys`, `onboarding`,
 *    and `stores.linkBank`. These stay under /api/v1/... .
 *  - **Existing merchant-app endpoints** for everything else (bank, stores, staff,
 *    roles, kyb, logo, payments, businesses, identity, businessTypes). These take the
 *    business in the URL via `:businessId`, which `http.ts` auto-fills from the active
 *    profile (the same source the X-Atoa-Business header used) — so call sites need
 *    only supply resource-specific params:
 *
 *   ctx.http.request({...V1_ROUTES.identity.get});
 *   ctx.http.request({...V1_ROUTES.stores.get, pathParams: {storeId}});  // :businessId auto-filled
 *
 * Purely declarative — no logic lives here.
 */
export interface V1Route {
  method: HttpMethod;
  path: string;
  auth: Extract<AuthMode, "jwt" | "none">;
}

const none = (method: HttpMethod, path: string): V1Route => ({method, path, auth: "none"});
const jwt = (method: HttpMethod, path: string): V1Route => ({method, path, auth: "jwt"});

export const V1_ROUTES = {
  auth: {
    /** PKCE code exchange — no Authorization header. */
    exchange: none("POST", "/api/v1/auth/exchange"),
    /** Rotate the access/refresh pair — no Authorization header. */
    refresh: none("POST", "/api/v1/auth/refresh"),
    /** Revoke the refresh token (logout) — no Authorization header. */
    revoke: none("POST", "/api/v1/auth/revoke"),
    // In-CLI OTP signup (BUD-019 Phase C). These are the EXISTING public app auth endpoints
    // (NOT the /v1 facade): send OTP → verify → otpVerifiedToken → sign-up (Bearer that token).
    otpSend: none("POST", "/api/otp/send"),
    otpVerify: none("POST", "/api/otp/verify-otp"),
    /** Sign up; pass source="CLI"+device to mint a CLI-source token (UserAuthController extension). */
    signUp: none("POST", "/api/user/auth/sign-up")
  },
  identity: {
    // Signed-in user's profile (the jwt-reachable identity route; /api/cli/identity is SDK-key only).
    get: jwt("GET", "/api/user/profile/")
  },
  businesses: {
    // Returns {business: BusinessToUser[], requests, metadata} for the signed-in user.
    list: jwt("GET", "/api/business/")
  },
  businessTypes: {
    list: jwt("GET", "/api/merchant/business-types/all")
  },
  apiKeys: {
    // :businessId auto-filled by http.ts from the active profile (no business header).
    list: jwt("GET", "/api/v1/businesses/:businessId/api-keys"),
    create: jwt("POST", "/api/v1/businesses/:businessId/api-keys"),
    delete: jwt("DELETE", "/api/v1/businesses/:businessId/api-keys/:keyId"),
    regenerate: jwt("POST", "/api/v1/businesses/:businessId/api-keys/:keyId/regenerate")
  },
  sessions: {
    list: jwt("GET", "/api/v1/auth/sessions"),
    delete: jwt("DELETE", "/api/v1/auth/sessions/:deviceId")
  },
  stores: {
    list: jwt("GET", "/api/business/:businessId/stores/"),
    get: jwt("GET", "/api/business/:businessId/stores/:storeId"),
    // Link an existing bank account to a store — programmatic-only /v1 route (no merchant equivalent).
    linkBank: jwt("PUT", "/api/v1/businesses/:businessId/stores/:storeId/bank")
  },
  bank: {
    // NOTE: list lives on a different merchant controller than the CRUD ops (returns a plain array).
    list: jwt("GET", "/api/merchant/:businessId/bank-account"),
    get: jwt("GET", "/api/business/:businessId/bank/:id"),
    // add re-sends itself with `otp` to verify (OTP 2-step) — see lib/otp.ts
    add: jwt("POST", "/api/business/:businessId/bank/"),
    delete: jwt("DELETE", "/api/business/:businessId/bank/:id")
  },
  // Supported bank institutions (the dashboard's BankSelect list). Standard app route
  // (not a /v1 facade), so the JWT session is accepted; used to populate `bank add`.
  institutions: {
    list: jwt("GET", "/api/institutions")
  },
  kyb: {
    // status returns an ad-hoc {status, ...} object (no DTO). `link` has no backend endpoint —
    // the dashboard KYB URL is built CLI-side from the dashboard base URL + businessId.
    status: jwt("GET", "/api/merchant/:businessId/getKybStatus")
  },
  logo: {
    // multipart field is `photo` (NOT `image`); ≤6 MB.
    upload: jwt("POST", "/api/merchant/:businessId/store/store-image")
  },
  staff: {
    list: jwt("GET", "/api/business/:businessId/users/"),
    create: jwt("POST", "/api/business/:businessId/users/")
  },
  roles: {
    list: jwt("GET", "/api/business/:businessId/users/role/")
  },
  onboarding: {
    // step-1/3/verify-otp/transaction-ranges are USER-scoped (no businessId). step-2/4/skip are
    // BUSINESS-scoped → /v1/businesses/:businessId/onboarding/... (:businessId auto-filled).
    step1: jwt("POST", "/api/v1/onboarding/step-1"),
    step2: jwt("POST", "/api/v1/businesses/:businessId/onboarding/step-2"),
    step3: jwt("POST", "/api/v1/onboarding/step-3"),
    step4: jwt("POST", "/api/v1/businesses/:businessId/onboarding/step-4"),
    skipStep4: jwt("POST", "/api/v1/businesses/:businessId/onboarding/step-4/skip"),
    transactionRanges: jwt("GET", "/api/v1/onboarding/transaction-ranges"),
    verifyOtp: jwt("POST", "/api/v1/onboarding/verify-otp")
  },
  payments: {
    links: {
      create: jwt("POST", "/api/payments/:businessId/generate-payment-link")
    }
  }
} as const;
