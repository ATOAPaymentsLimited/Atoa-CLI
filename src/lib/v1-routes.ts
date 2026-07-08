import type {AuthMode, HttpMethod} from "./http";

export interface V1Route {
  method: HttpMethod;
  path: string;
  auth: Extract<AuthMode, "jwt" | "none">;
}

const none = (method: HttpMethod, path: string): V1Route => ({method, path, auth: "none"});
const jwt = (method: HttpMethod, path: string): V1Route => ({method, path, auth: "jwt"});

export const V1_ROUTES = {
  auth: {
    exchange: none("POST", "/api/auth/extension-token/exchange"),
    refresh: none("POST", "/api/auth/extension-token/refresh"),
    revoke: none("POST", "/api/auth/extension-token/revoke"),
    otpSend: none("POST", "/api/otp/send-otp"),
    otpVerify: none("POST", "/api/otp/verify-otp"),
    signUp: none("POST", "/api/user/auth/sign-up")
  },
  identity: {
    get: jwt("GET", "/api/user/profile/")
  },
  businesses: {
    list: jwt("GET", "/api/business/")
  },
  businessTypes: {
    list: jwt("GET", "/api/merchant/business-types/all")
  },
  apiKeys: {
    list: jwt("GET", "/api/merchant/:businessId/v1/api-access"),
    create: jwt("POST", "/api/merchant/:businessId/v1/api-access/:env"),
    delete: jwt("DELETE", "/api/merchant/:businessId/v1/api-access/:keyId"),
    regenerate: jwt("PUT", "/api/merchant/:businessId/v1/api-access/:keyId/revoke")
  },
  sessions: {
    list: jwt("GET", "/api/user/auth/sessions"),
    delete: jwt("DELETE", "/api/user/auth/sessions/:deviceId")
  },
  stores: {
    list: jwt("GET", "/api/business/:businessId/stores/"),
    get: jwt("GET", "/api/business/:businessId/stores/:storeId"),
    linkBank: jwt("PUT", "/api/business/:businessId/stores/:storeId/bank")
  },
  bank: {
    list: jwt("GET", "/api/merchant/:businessId/bank-account"),
    get: jwt("GET", "/api/business/:businessId/bank/:id"),
    add: jwt("POST", "/api/business/:businessId/bank/"),
    delete: jwt("DELETE", "/api/business/:businessId/bank/:id")
  },
  institutions: {
    list: jwt("GET", "/api/institutions")
  },
  kyb: {
    status: jwt("GET", "/api/merchant/:businessId/getKybStatus")
  },
  logo: {
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
    createBusiness: jwt("POST", "/api/business/"),
    getBusiness: jwt("GET", "/api/business/:businessId"),
    updateBusiness: jwt("PUT", "/api/business/:businessId"),
    acceptTerms: jwt("PUT", "/api/business/:businessId/accept-terms"),
    marketingConsent: jwt("PUT", "/api/business/:businessId/communication-preferences/marketing-consent"),
    updateProfile: jwt("PUT", "/api/user/profile"),
    updateContact: jwt("PUT", "/api/user/profile/contact"),
    notificationOptions: jwt("PUT", "/api/user/profile/notification-options"),
    businessTypes: jwt("GET", "/api/merchant/business-types/all"),
    signupSources: jwt("GET", "/api/signup-source/all"),
    transactionRanges: jwt("GET", "/api/merchant/average-transaction/ranges")
  },
  payments: {
    links: {
      create: jwt("POST", "/api/business/:businessId/links/payment/store/:storeId"),
      get: jwt("GET", "/api/business/:businessId/links/payment/store/:storeId/link/:linkId"),
      delete: jwt("DELETE", "/api/business/:businessId/links/payment/store/:storeId/link/:linkId")
    }
  }
} as const;
