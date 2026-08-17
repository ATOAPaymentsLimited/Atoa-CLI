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
    linkBank: jwt("PUT", "/api/business/:businessId/stores/:storeId/bank"),
    // Store metadata upsert (id present in body = update, absent = create). Different
    // controller/prefix than the read routes above — merchant-prefixed, like logo.upload.
    upsert: jwt("POST", "/api/merchant/:businessId/store")
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
    create: jwt("POST", "/api/business/:businessId/users/"),
    // `:userId` is the person's user id, not the business-user link id — the backend refuses
    // when it matches the caller's own id, which only makes sense against the former.
    update: jwt("PUT", "/api/business/:businessId/users/:userId"),
    remove: jwt("DELETE", "/api/business/:businessId/users/:userId")
  },
  roles: {
    list: jwt("GET", "/api/business/:businessId/users/role/"),
    create: jwt("POST", "/api/business/:businessId/users/role/"),
    update: jwt("PUT", "/api/business/:businessId/users/role/:roleId"),
    delete: jwt("DELETE", "/api/business/:businessId/users/role/:roleId")
  },
  permissions: {
    list: jwt("GET", "/api/permissions/:businessId/list")
  },
  options: {
    get: jwt("GET", "/api/business/:businessId/options"),
    update: jwt("PUT", "/api/business/:businessId/options")
  },
  communicationPreferences: {
    list: jwt("GET", "/api/business/:businessId/communication-preferences"),
    update: jwt("PUT", "/api/business/:businessId/communication-preferences")
  },
  customSenderName: {
    get: jwt("GET", "/api/merchant/custom-sender-name/:businessId"),
    create: jwt("POST", "/api/merchant/custom-sender-name/:businessId"),
    update: jwt("PUT", "/api/merchant/custom-sender-name/:businessId/updateDetails/:customOptionId"),
    remove: jwt("DELETE", "/api/merchant/custom-sender-name/:businessId/delete-custom-options/:customOptionId")
  },
  addons: {
    // Feature usage and plan management are served by two different upstreams behind the
    // gateway, hence the two path shapes. Plan management accepts the merchant JWT as-is.
    featureUsage: jwt("GET", "/api/merchant/addonPlan/:businessId/featureUsage"),
    current: jwt("GET", "/api/addonPlan/merchant/:businessId/current"),
    available: jwt("GET", "/api/addonPlan/merchant/:businessId/available"),
    estimatedCharges: jwt("GET", "/api/addonPlan/merchant/:businessId/estimatedMonthlyCharges"),
    upgrade: jwt("POST", "/api/addonPlan/merchant/:businessId/upgrade/:addonPlanId"),
    downgrade: jwt("POST", "/api/addonPlan/merchant/:businessId/downgrade/:addonPlanId"),
    cancelDowngrade: jwt("DELETE", "/api/addonPlan/merchant/:businessId/cancelDowngrade")
  },
  cardActivation: {
    // Read-only from the CLI. Submitting an application, and uploading the bank/card
    // statements it requires, both happen in the dashboard (see `kyb card link`) — the
    // CLI reports state and hands off rather than duplicating that wizard.
    status: jwt("GET", "/api/business/:businessId/card-activation")
  },
  directDebit: {
    // These sit under /api like every other route here; the un-prefixed variants 404 at
    // the gateway. Verified live — assignedPlan returns the merchant's plan.
    assignedPlan: jwt("GET", "/api/plan/:businessId/assignedPlan"),
    confirmSetup: jwt("POST", "/api/stripe/:businessId/confirm-setup-intent")
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
