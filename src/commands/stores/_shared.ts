import {AtoaError} from "../../lib/errors";
import {V1_ROUTES} from "../../lib/v1-routes";
import {t} from "../../lib/i18n";
import {AddonFeatureType} from "../../lib/enums";
import {DEFAULT_STORE_NAME} from "../../lib/constants";
import {maskAccountNumber} from "../../lib/validators";
import {fetchCurrentPlan, fetchFeatureUsage, planFeatureMap} from "../addons/_shared";
import type {CommandContext} from "../../lib/context";

export interface StoreRow {
  id?: string;
  locationName?: string;
  addressLine1?: string;
  addressLine2?: string;
  addressPostalCode?: string;
  cityOrTown?: string;
  primary?: boolean;
  enabled?: boolean;
  bankAccount?: {bankName?: string; maskedAccountNumber?: string; accountNumber?: string};
}

/**
 * Trims a store to what's readable in a terminal — the raw record nests the whole bank account
 * and every uploaded image, plus timestamps; only the bank's name and masked number survive.
 */
export function projectStore(row: StoreRow): Record<string, unknown> {
  const bank = row.bankAccount;
  const masked = bank?.maskedAccountNumber ?? maskAccountNumber(bank?.accountNumber);

  return {
    id: row.id,
    locationName: row.locationName,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    addressPostalCode: row.addressPostalCode,
    cityOrTown: row.cityOrTown,
    primary: row.primary,
    enabled: row.enabled,
    bankAccount: [bank?.bankName, masked].filter(Boolean).join("  ·  ")
  };
}

/** These endpoints return either a bare array or a `{data: []}` envelope depending on the route. */
function asArray(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  const inner = (data as {data?: unknown})?.data;
  return Array.isArray(inner) ? inner : [];
}

/**
 * Would the current plan allow another location? Deliberately optimistic: when the plan can't
 * be read we return true and let the backend decide, rather than inventing a refusal.
 */
async function planAllowsAnotherStore(ctx: CommandContext): Promise<boolean> {
  try {
    const [plan, usage] = await Promise.all([fetchCurrentPlan(ctx), fetchFeatureUsage(ctx)]);
    const feature = plan.addonPlan ? planFeatureMap(plan.addonPlan).get(AddonFeatureType.MULTI_STORE) : undefined;
    if (!feature) return false; // not part of the plan at all
    if (feature.limit == null || feature.overlimitCharges > 0) return true; // uncapped, or extras are chargeable
    const used = usage.find((u) => u.featureType === AddonFeatureType.MULTI_STORE)?.usage ?? 0;
    return used < feature.limit;
  } catch {
    return true;
  }
}

/**
 * Client-side only — the API accepts a store without a bank account, so its sole refusal here is
 * the addon limit, which reads as "upgrade your plan" when the real blocker is a missing account.
 */
async function assertBankLinked(ctx: CommandContext, stores: StoreRow[]): Promise<void> {
  const {data} = await ctx.http.request({...V1_ROUTES.bank.list});
  if (asArray(data).length > 0) return;
  // A store can hold a bank account the business-level list above doesn't return.
  if (stores.some((s) => s?.bankAccount != null)) return;

  throw new AtoaError(t("bankAccountNotLinked"), "validation");
}

/** A business whose only location is the untouched DEFAULT one. */
const isOnlyDefaultStore = (stores: StoreRow[]): boolean =>
  stores.length === 1 && stores[0]?.locationName?.toUpperCase() === DEFAULT_STORE_NAME;

/**
 * Decides what `stores add` should actually do.
 *
 * A business still on its single DEFAULT location updates that one in place rather than gaining a
 * second — so the plan limit doesn't apply, since no location is being added. Every other case
 * checks the plan first and defers to the backend's refusal when that is the binding constraint,
 * so a merchant who is both over the limit and bankless is told to upgrade, not to add a bank
 * account they still couldn't use. A bank account is required either way.
 */
export async function resolveStoreToUpdate(ctx: CommandContext): Promise<StoreRow | undefined> {
  const stores = asArray((await ctx.http.request({...V1_ROUTES.stores.list})).data) as StoreRow[];
  const renamingDefault = isOnlyDefaultStore(stores);

  if (!renamingDefault && !(await planAllowsAnotherStore(ctx))) return undefined;

  await assertBankLinked(ctx, stores);
  return renamingDefault ? stores[0] : undefined;
}
