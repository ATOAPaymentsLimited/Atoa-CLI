import {V1_ROUTES} from "../../lib/v1-routes";
import {isValidEmail, validateAddress, validateAddressLine2, validatePostcode} from "../../lib/validators";
import {AtoaError} from "../../lib/errors";
import {MandateStatus} from "../../lib/enums";
import {t} from "../../lib/i18n";
import type {CommandContext} from "../../lib/context";

/**
 * Direct Debit field rules.
 *
 * A digit field reports its two failure modes separately: wrong characters and wrong length are
 * different mistakes, and telling someone who typed "12jjjjjj" that the value must be 8
 * characters long names the wrong problem — they typed exactly 8.
 */
const digitsOfLength =
  (length: number, wrongChars: string, wrongLength: string) =>
  (v: string): true | string => {
    const s = v.trim();
    if (!/^\d*$/.test(s)) return wrongChars;
    return s.length === length || wrongLength;
  };

export const RULES: Record<string, (value: string) => true | string> = {
  accountNumber: digitsOfLength(8, t("bankAccountNumberDigitsError"), t("bankAccountNumberLengthError")),
  sortCode: digitsOfLength(6, t("sortCodeDigitsErrorMsg"), t("sortCodeLengthErrorMsg")),
  name: (v) => {
    const s = v.trim();
    if (!s) return t("accountHolderNameRequiredErrorMsg");
    // 20, not the 100 allowed elsewhere — this is what the mandate's name field accepts.
    return s.length <= 20 || t("accountHolderNameMaxErrorMsg");
  },
  email: (v) => isValidEmail(v.trim()) || t("emailError"),
  // Address, line 2 and postcode reuse the shared address validators. Postcode is the more
  // permissive of the two rules on purpose: "SW1 1AA" is accepted here and the space stripped
  // before the value is sent.
  addressLine1: validateAddress,
  addressLine2: validateAddressLine2,
  city: (v) => (validateAddress(v) === true ? true : t("cityOrTownError")),
  postalCode: validatePostcode
};

export interface DirectDebitPrefill {
  accountNumber?: string;
  maskedAccountNumber?: string;
  sortCode?: string;
  bankCode?: string;
  bankName?: string;
  name?: string;
  email?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  postalCode?: string;
}

export interface PrefillSources {
  /** Every bank account on file, newest-usable first. Offered as a picker when there is a choice. */
  accounts: BankAccount[];
  name?: string;
  email?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  postalCode?: string;
}

/**
 * Reads everything the form can be pre-filled from: the bank accounts on file, the signed-in
 * user's name and email, and the business address.
 *
 * Every call is best-effort — a merchant with no bank account on file, or an endpoint that
 * errors, should still be able to type the details in by hand.
 */
export async function fetchPrefillSources(ctx: CommandContext): Promise<PrefillSources> {
  const [bank, user, business] = await Promise.all([
    request<BankAccount[]>(ctx, V1_ROUTES.bank.list),
    request<UserProfile>(ctx, V1_ROUTES.identity.get),
    request<Business>(ctx, V1_ROUTES.onboarding.getBusiness)
  ]);

  const all = Array.isArray(bank) ? bank : [];
  const info = business?.businessInfo;
  const firstName = user?.firstName?.trim();
  const lastName = user?.lastName?.trim();

  return {
    // Enabled accounts first so the default selection is a usable one.
    accounts: [...all.filter((a) => a?.enabled !== false), ...all.filter((a) => a?.enabled === false)],
    // Only offer a name when both halves are present, rather than a half-complete "Jane undefined".
    name: firstName && lastName ? `${firstName} ${lastName}` : undefined,
    email: user?.email,
    addressLine1: info?.addressLine1,
    addressLine2: info?.addressLine2,
    city: info?.cityOrTown,
    postalCode: info?.addressPostalCode?.toString()
  };
}

export interface AssignedPlan {
  stripeCustomer?: {mandateDetails?: {status?: string}};
}

/**
 * Whether a usable mandate exists. Derived from the mandate's own status — the response carries
 * no `isDirectDebitSetup` field, so reading one silently yields undefined and reports "not set
 * up" for a merchant who has an active mandate.
 */
export function hasActiveMandate(plan: AssignedPlan | undefined): boolean {
  return plan?.stripeCustomer?.mandateDetails?.status === MandateStatus.ACTIVE;
}

/**
 * The merchant's assigned plan, or undefined when they have none.
 *
 * A merchant with no plan is a normal early state, but the endpoint reports it as an error
 * ("No Plan found for this Merchant"). Callers want to branch on it, not fail on it.
 */
export async function fetchAssignedPlan(ctx: CommandContext): Promise<AssignedPlan | undefined> {
  try {
    const {data} = await ctx.http.request({...V1_ROUTES.directDebit.assignedPlan});
    return (data ?? {}) as AssignedPlan;
  } catch (err) {
    if (err instanceof AtoaError && /no plan found/i.test(err.message)) return undefined;
    throw err;
  }
}

/** Folds a chosen bank account into the rest of the pre-filled values. */
export function prefillFor(sources: PrefillSources, account: BankAccount | undefined): DirectDebitPrefill {
  return {
    accountNumber: account?.accountNumber,
    maskedAccountNumber: account?.maskedAccountNumber,
    sortCode: account?.sortCode,
    bankCode: account?.bankCode,
    bankName: account?.bankName,
    name: sources.name,
    email: sources.email,
    addressLine1: sources.addressLine1,
    addressLine2: sources.addressLine2,
    city: sources.city,
    postalCode: sources.postalCode
  };
}

/** One-line description of a bank account for the picker, never showing the full number. */
export function describeAccount(a: BankAccount): string {
  return (
    [
      a.bankName,
      a.maskedAccountNumber ?? maskNumber(a.accountNumber),
      a.sortCode,
      a.enabled === false ? "(disabled)" : null
    ]
      .filter(Boolean)
      .join("  ·  ") || t("unnamedAccount")
  );
}

/** Renders a hint for a prefilled account number without printing it in full. */
export function maskAccountNumber(prefill: DirectDebitPrefill): string | undefined {
  return prefill.maskedAccountNumber ?? maskNumber(prefill.accountNumber);
}

function maskNumber(full: string | undefined): string | undefined {
  const s = full?.trim();
  return s && s.length >= 4 ? `••••${s.slice(-4)}` : undefined;
}

export type BankAccount = {
  accountNumber?: string;
  maskedAccountNumber?: string;
  sortCode?: string;
  bankCode?: string;
  bankName?: string;
  enabled?: boolean;
};
type UserProfile = {firstName?: string; lastName?: string; email?: string};
type Business = {
  businessInfo?: {
    addressLine1?: string;
    addressLine2?: string;
    cityOrTown?: string;
    addressPostalCode?: string | number;
  };
};

async function request<T>(
  ctx: CommandContext,
  route: {method: string; path: string; auth: string}
): Promise<T | undefined> {
  try {
    const {data} = await ctx.http.request({...(route as Parameters<CommandContext["http"]["request"]>[0])});
    return data as T;
  } catch {
    return undefined;
  }
}
