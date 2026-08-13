import {V1_ROUTES} from "../../lib/v1-routes";
import {AtoaError} from "../../lib/errors";
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
      if (featureType === "MULTI_BANK_ACCOUNT" && used === 1) continue;
      if (used > 0) blockers.push(`${featureType}: in use (${used}) but not included in ${target.name}`);
      continue;
    }

    if (feature.limit && used > feature.limit && feature.overlimitCharges <= 0) {
      blockers.push(`${featureType}: ${used} in use, ${target.name} allows ${feature.limit}`);
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

export function formatPlanChoice(p: AddonPlan): string {
  const price = p.monthlyAmount != null ? `£${p.monthlyAmount}/mo` : "price n/a";
  return `${p.name} — ${price}`;
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
    throw new AtoaError(`No plans available to ${opts.verb} to from your current plan.`, "validation");
  }

  if (explicitId) {
    const found = candidates.find((p) => p.id === explicitId);
    if (!found) {
      throw new AtoaError(
        `Plan "${explicitId}" is not available to ${opts.verb} to. Options: ${candidates
          .map((p) => `${p.name} (${p.id})`)
          .join(", ")}`,
        "validation"
      );
    }
    return found;
  }

  if (!opts.interactive) {
    throw new AtoaError(
      `a plan id is required (non-interactive). Available: ${candidates.map((p) => `${p.name}=${p.id}`).join(", ")}`,
      "validation"
    );
  }

  const {select} = await import("@inquirer/prompts");
  const id = await select({
    message: `Select the plan to ${opts.verb} to:`,
    choices: candidates.map((p) => ({value: p.id, name: formatPlanChoice(p)}))
  });
  return candidates.find((p) => p.id === id) as AddonPlan;
}
