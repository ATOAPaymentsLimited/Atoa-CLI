/**
 * Normalises the `/api/business/` (merchant-app) response into the flat shape the CLI
 * commands display. The endpoint returns `{business: BusinessToUser[], requests, metadata}`,
 * where each entry's `.business` is the MerchantEntity. The businessId the CLI binds to is
 * the merchant id (`bu.business.id`); the display name lives on the `businessInfo` relation.
 *
 * Replaces the old /v1 BusinessSummaryResponse the facade used to return.
 */
export interface BusinessSummary {
  id: string;
  legalBusinessName: string;
  status: string;
}

export function normalizeBusinesses(data: unknown): BusinessSummary[] {
  const list = (data && typeof data === "object" ? (data as Record<string, unknown>)["business"] : undefined) ?? data;
  if (!Array.isArray(list)) return [];
  return list
    .map((row) => {
      const bu = row as {business?: {id?: string; status?: string; businessInfo?: {legalBusinessName?: string}}};
      const merchant = bu.business;
      if (!merchant?.id) return undefined;
      return {
        id: merchant.id,
        legalBusinessName: merchant.businessInfo?.legalBusinessName ?? "",
        status: merchant.status ?? ""
      };
    })
    .filter((b): b is BusinessSummary => b !== undefined);
}
