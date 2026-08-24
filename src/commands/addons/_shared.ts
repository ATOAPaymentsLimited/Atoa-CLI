import {V1_ROUTES} from "../../lib/v1-routes";
import {AtoaError} from "../../lib/errors";
import {AddonFeatureType, KYB_NOT_APPROVED, type MerchantStatus} from "../../lib/enums";
import {t} from "../../lib/i18n";
import type {CommandContext} from "../../lib/context";

/** One row of `GET merchant/addonPlan/:businessId/featureUsage`. */
export interface FeatureUsage {
  featureType: string;
  usage: number;
}

/** A feature as attached to a plan, from `available`. `limit: null` means included-but-uncapped. */
export interface PlanFeature {
  addonFeatureType?: string;
  limit?: number | null;
  overlimitCharges?: number;
}

export interface AddonPlan {
  id: string;
  name: string;
  monthlyAmount?: number;
  yearlyAmount?: number;
  planOrder: number;
  subscribablePlan?: boolean;
  addonFeatureToAddonPlans?: Array<{limit?: number | null; addonFeature?: PlanFeature}>;
}

export interface AvailablePlans {
  availablePlans?: AddonPlan[];
  mostPopularPlanId?: string;
  trialAvailable?: boolean;
}

/** `GET .../current` — the merchant's active subscription. */
export interface CurrentPlan {
  id?: string;
  addonPlan?: AddonPlan;
  startDate?: string;
  endDate?: string;
  status?: boolean;
  renewalType?: string;
}

/**
 * Add-ons are only purchasable once verification passes, so refuse client-side with "verify your
 * business" rather than letting the request fail less clearly. Downgrades are NOT gated.
 *
 * Best-effort: an unreadable business record lets the attempt through to the backend rather than
 * inventing a refusal.
 */
export async function assertKybApprovedForUpgrade(ctx: CommandContext): Promise<void> {
  let status: string | undefined;
  try {
    const {data} = await ctx.http.request({...V1_ROUTES.onboarding.getBusiness});
    status = (data as {business?: {status?: string}})?.business?.status;
  } catch {
    return;
  }
  if (status && KYB_NOT_APPROVED.includes(status as MerchantStatus)) {
    throw new AtoaError(t("addonsNeedVerifiedBusiness"), "validation");
  }
}

export async function fetchCurrentPlan(ctx: CommandContext): Promise<CurrentPlan> {
  const {data} = await ctx.http.request({...V1_ROUTES.addons.current});
  return (data ?? {}) as CurrentPlan;
}

export async function fetchAvailablePlans(ctx: CommandContext): Promise<AvailablePlans> {
  const {data} = await ctx.http.request({...V1_ROUTES.addons.available});
  return (data ?? {}) as AvailablePlans;
}

export async function fetchFeatureUsage(ctx: CommandContext): Promise<FeatureUsage[]> {
  const {data} = await ctx.http.request({...V1_ROUTES.addons.featureUsage});
  return (data ?? []) as FeatureUsage[];
}

/** Flattens a plan's feature list into featureType -> {limit, overlimitCharges}. */
export function planFeatureMap(plan: AddonPlan): Map<string, {limit: number | null; overlimitCharges: number}> {
  const map = new Map<string, {limit: number | null; overlimitCharges: number}>();
  for (const row of plan.addonFeatureToAddonPlans ?? []) {
    const type = row.addonFeature?.addonFeatureType;
    if (!type) continue;
    // The cap lives on the join row in some payloads and on the feature in others.
    const limit = row.limit ?? row.addonFeature?.limit ?? null;
    map.set(type, {limit, overlimitCharges: row.addonFeature?.overlimitCharges ?? 0});
  }
  return map;
}

/**
 * Mirrors the backend's downgrade eligibility rule so we can tell the user WHICH features
 * block a downgrade — the backend returns a single generic 428 that names none of them.
 *
 * The backend remains the authority: this only explains a refusal (and previews one before
 * you confirm). If the two ever disagree, the backend's answer is the real one.
 */
export function downgradeBlockers(usage: FeatureUsage[], target: AddonPlan): string[] {
  const features = planFeatureMap(target);
  const blockers: string[] = [];

  for (const {featureType, usage: used} of usage) {
    const feature = features.get(featureType);

    if (!feature) {
      // One bank account is always permitted, even on plans without the feature.
      if (featureType === AddonFeatureType.MULTI_BANK_ACCOUNT && used === 1) continue;
      if (used > 0) {
        blockers.push(t("downgradeBlockerNotIncluded", {feature: featureType, used, plan: target.name}));
      }
      continue;
    }

    if (feature.limit && used > feature.limit && feature.overlimitCharges <= 0) {
      blockers.push(
        t("downgradeBlockerOverLimit", {feature: featureType, used, plan: target.name, limit: feature.limit})
      );
    }
  }

  return blockers;
}

/** Plans the merchant can move to, split by direction relative to the current plan's order. */
export function partitionByDirection(
  plans: AddonPlan[],
  currentOrder: number
): {upgrades: AddonPlan[]; downgrades: AddonPlan[]} {
  const subscribable = plans.filter((p) => p.subscribablePlan !== false);
  return {
    upgrades: subscribable.filter((p) => p.planOrder > currentOrder).sort((a, b) => a.planOrder - b.planOrder),
    downgrades: subscribable.filter((p) => p.planOrder < currentOrder).sort((a, b) => b.planOrder - a.planOrder)
  };
}

/** Usage against the plan's cap — a bare `1` doesn't say whether the plan allows one or five. */
export function formatFeatureUsage(used: number, feature?: {limit: number | null; overlimitCharges: number}): string {
  if (!feature) return t("usageNotIncluded", {used});
  // Falsy, not just null: the backend caps on `!featureLimit`, so a 0 is uncapped there too and
  // rendering it as "0 / 0" would read as a refusal where the API allows the action.
  if (!feature.limit) return t("usageUnlimited", {used});
  if (feature.overlimitCharges > 0) {
    return t("usageWithOverage", {used, limit: feature.limit, amount: feature.overlimitCharges});
  }
  return t("usageOfLimit", {used, limit: feature.limit});
}

export function formatPlanChoice(p: AddonPlan): string {
  const price = p.monthlyAmount != null ? t("planPriceMonthly", {amount: p.monthlyAmount}) : t("priceUnavailable");
  return t("planChoice", {name: p.name, price});
}

/**
 * Resolves the target plan: an explicit id (validated against the candidate list) or an
 * interactive pick. Non-TTY without an id is a validation error rather than a silent default —
 * this changes billing, so it must never be implicit.
 */
export async function resolveTargetPlan(
  candidates: AddonPlan[],
  explicitId: string | undefined,
  opts: {interactive: boolean; verb: string}
): Promise<AddonPlan> {
  if (candidates.length === 0) {
    throw new AtoaError(t("noPlansAvailable", {verb: opts.verb}), "validation");
  }

  if (explicitId) {
    const found = candidates.find((p) => p.id === explicitId);
    if (!found) {
      const options = candidates.map((p) => t("planNameWithId", {name: p.name, id: p.id})).join(", ");
      throw new AtoaError(t("planNotAvailable", {plan: explicitId, verb: opts.verb, options}), "validation");
    }
    return found;
  }

  if (!opts.interactive) {
    const available = candidates.map((p) => t("planNameEqId", {name: p.name, id: p.id})).join(", ");
    throw new AtoaError(t("planIdRequiredNonInteractive", {available}), "validation");
  }

  const {select} = await import("@inquirer/prompts");
  const id = await select({
    message: t("selectPlanToChangeTo", {verb: opts.verb}),
    choices: candidates.map((p) => ({value: p.id, name: formatPlanChoice(p)}))
  });
  return candidates.find((p) => p.id === id) as AddonPlan;
}
