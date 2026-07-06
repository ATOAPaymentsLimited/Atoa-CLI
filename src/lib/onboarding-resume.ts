const EDITABLE_STATUSES = new Set(["PENDING", "REJECTED", "KYB_HOLD"]);

export interface BusinessRecord {
  status?: string | null;
  businessInfo?: {
    legalBusinessName?: string | null;
    companyType?: string | null;
    addressLine1?: string | null;
    addressPostalCode?: string | null;
  } | null;
}

export type ResumeState = {kind: "resume"; step: 2 | 3} | {kind: "complete"} | {kind: "locked"; status: string};

export function onboardingResumeState(business: BusinessRecord): ResumeState {
  const status = business.status || "PENDING";
  if (!EDITABLE_STATUSES.has(status)) return {kind: "locked", status};
  const info = business.businessInfo ?? {};
  if (!info.companyType) return {kind: "resume", step: 2};
  if (!info.addressLine1 || !info.addressPostalCode) return {kind: "resume", step: 3};
  return {kind: "complete"};
}
