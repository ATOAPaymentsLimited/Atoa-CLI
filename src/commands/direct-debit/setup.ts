import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {isInteractive} from "../../lib/output";
import {AtoaError} from "../../lib/errors";
import {resolveField} from "../../lib/prompt-field";
import {
  RULES,
  fetchPrefillSources,
  prefillFor,
  describeAccount,
  maskAccountNumber,
  fetchAssignedPlan,
  type DirectDebitPrefill,
  type BankAccount
} from "./_shared";
import t from "../../locales/en.json";
import type {CommandContext} from "../../lib/context";

type Field = "accountNumber" | "sortCode" | "name" | "email" | "addressLine1" | "addressLine2" | "city" | "postalCode";

type DirectDebitSetupArgs = CommonOptions & Partial<Record<Field, string>>;

/** Field order matches the Direct Debit form so the two flows ask for things in the same sequence. */
const PROMPTS: Array<[Field, string]> = [
  ["accountNumber", t.labelAccountNumber],
  ["sortCode", t.labelSortCode],
  ["name", t.labelNameOnAccount],
  ["email", t.labelEmailAddress],
  ["addressLine1", t.labelAddressLine1],
  ["addressLine2", t.labelAddressLine2Optional],
  ["city", t.labelTownCity],
  ["postalCode", t.labelPostalCode]
];

const REQUIRED: Field[] = ["accountNumber", "sortCode", "name", "email", "addressLine1", "city", "postalCode"];

export default defineCommand({
  meta: {
    name: "setup",
    description: "Set up the direct-debit mandate for platform fees (bank + billing details, then confirm the mandate)"
  },
  args: withCommonArgs({
    accountNumber: {type: "string", description: "8-digit UK account number"},
    sortCode: {type: "string", description: "6-digit UK sort code"},
    name: {type: "string", description: "name on account (max 20 characters)"},
    email: {type: "string", description: "billing email"},
    addressLine1: {type: "string", description: "billing address line 1"},
    addressLine2: {type: "string", description: "billing address line 2"},
    city: {type: "string", description: "billing town/city"},
    postalCode: {type: "string", description: "billing postal code"}
  }),
  run: runWithContext<DirectDebitSetupArgs>(async (ctx, args) => {
    const interactive = isInteractive(ctx.formatExplicit);

    // A mandate is set up once. Checked before anything is asked, so the merchant is not walked
    // through nine fields only to be refused at the end.
    await assertNoActiveMandate(ctx);

    // Pre-filling is pointless without prompts, so the lookups are skipped entirely when
    // nothing will be asked.
    const prefill: DirectDebitPrefill = interactive ? await resolvePrefill(ctx) : {};
    const fields = await collectFields(args, prefill, interactive);

    await assertMandateAccepted(interactive);

    const body = buildBody(fields, prefill.bankCode);

    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.directDebit.confirmSetup, body});
      return;
    }

    await ctx.http.request({...V1_ROUTES.directDebit.confirmSetup, body});
    const {data: confirmed} = await ctx.http.request({...V1_ROUTES.directDebit.assignedPlan});
    ctx.print(confirmed);
  })
});

/**
 * Chooses which bank account the form is pre-filled from.
 *
 * With more than one on file the merchant picks, and the account number, sort code and bank
 * code all follow that choice — picking a different account re-fills those three, it does not
 * leave the first account's details behind. With none on file the bank is chosen from the
 * institution list instead, which fixes the bank code while the account details are typed.
 */
async function resolvePrefill(ctx: CommandContext): Promise<DirectDebitPrefill> {
  const sources = await fetchPrefillSources(ctx);

  if (sources.accounts.length === 0) {
    return {...prefillFor(sources, undefined), bankCode: await pickInstitutionCode(ctx)};
  }
  if (sources.accounts.length === 1) {
    return prefillFor(sources, sources.accounts[0]);
  }

  const {select} = await import("@inquirer/prompts");
  const chosen = await select<BankAccount>({
    message: "Bank account",
    pageSize: 12,
    choices: sources.accounts.map((a) => ({name: describeAccount(a), value: a}))
  });
  return prefillFor(sources, chosen);
}

/** Bank picker for a merchant with no account on file — sets the bank code only. */
async function pickInstitutionCode(ctx: CommandContext): Promise<string | undefined> {
  try {
    const {data} = await ctx.http.request({...V1_ROUTES.institutions.list});
    const banks = (Array.isArray(data) ? data : []) as Array<{
      fullName?: string;
      name?: string;
      bankCode?: string;
      businessBank?: boolean;
    }>;
    const usable = banks.filter((b) => b.bankCode);
    if (usable.length === 0) return undefined;

    const {select} = await import("@inquirer/prompts");
    return await select<string | undefined>({
      message: "Bank",
      pageSize: 12,
      choices: [
        ...usable.map((b) => ({
          name: [b.fullName || b.name, b.businessBank ? "Business" : "Personal"].filter(Boolean).join("  ·  "),
          value: b.bankCode
        })),
        {name: "— Skip —", value: undefined}
      ]
    });
  } catch {
    // The bank code is optional; failing to list institutions must not block the mandate.
    return undefined;
  }
}

async function collectFields(
  args: DirectDebitSetupArgs,
  prefill: DirectDebitPrefill,
  interactive: boolean
): Promise<Partial<Record<Field, string>>> {
  const fields: Partial<Record<Field, string>> = {
    accountNumber: await collectAccountNumber(args.accountNumber?.trim(), prefill, interactive)
  };

  for (const [key, label] of PROMPTS) {
    if (key === "accountNumber") continue;
    fields[key] = await resolveField({
      value: args[key],
      flag: toFlag(key),
      message: label,
      rule: RULES[key],
      interactive,
      optional: !REQUIRED.includes(key),
      default: prefill[key]
    });
  }
  return fields;
}

/**
 * The account number is never offered as an editable default — that would echo it in full.
 * A stored number is offered in masked form and kept on an empty answer instead.
 */
async function collectAccountNumber(
  supplied: string | undefined,
  prefill: DirectDebitPrefill,
  interactive: boolean
): Promise<string | undefined> {
  const masked = maskAccountNumber(prefill);
  if (!supplied && interactive && masked && prefill.accountNumber) {
    const {input} = await import("@inquirer/prompts");
    const answer = (
      await input({
        message: `Account number (${masked} on file — press Enter to keep)`,
        validate: (v) => (v.trim() ? RULES.accountNumber(v) : true)
      })
    ).trim();
    if (!answer) return prefill.accountNumber;
    await confirmAccountNumber(answer);
    return answer;
  }

  const value = await resolveField({
    value: supplied,
    flag: "account-number",
    message: "Account number",
    rule: RULES.accountNumber,
    interactive
  });
  // The typo guard only earns its keystrokes for a number typed at the prompt.
  if (interactive && !supplied && value) await confirmAccountNumber(value);
  return value;
}

/** Typo guard on the account number, so it only makes sense for a number typed at the prompt. */
async function confirmAccountNumber(accountNumber: string): Promise<void> {
  const {input} = await import("@inquirer/prompts");
  const again = (
    await input({
      message: "Confirm account number",
      validate: (v) => v.trim() === accountNumber || "account numbers do not match"
    })
  ).trim();
  if (again !== accountNumber) throw new AtoaError("account numbers do not match", "validation");
}

/**
 * Refuses to set up a second mandate. Changing the bank a mandate debits is a Direct Debit
 * amendment, not a re-run of setup, so it is deliberately not offered here.
 */
async function assertNoActiveMandate(ctx: CommandContext): Promise<void> {
  const plan = await fetchAssignedPlan(ctx);
  if (!plan?.isDirectDebitSetup) return;

  const status = plan.stripeCustomer?.mandateDetails?.status;
  throw new AtoaError(
    `A Direct Debit mandate is already set up for this business${status ? ` (status: ${status})` : ""}. ` +
      "It cannot be set up again — run `atoa direct-debit status` to review it, or contact Atoa support to change " +
      "the account it debits.",
    "validation"
  );
}

/**
 * Mandate acceptance, asked as the last question before the mandate is created. Answering no
 * stops the run — the mandate cannot be set up without it.
 */
async function assertMandateAccepted(interactive: boolean): Promise<void> {
  if (!interactive) return;
  const {confirm} = await import("@inquirer/prompts");
  const accepted = await confirm({message: t.mandateAcceptTerms, default: true});
  if (!accepted) throw new AtoaError("the direct-debit mandate was not accepted", "validation");
}

/**
 * Wire shape for the Direct Debit request — including the fixed GB/UK address pair, which is
 * never collected, and the millisecond `accepted_at` every caller of this endpoint sends.
 * `user_agent` records the channel the mandate was actually accepted through.
 */
function buildBody(fields: Partial<Record<Field, string>>, bankCode: string | undefined) {
  const body: Record<string, unknown> = {
    mandate_data: {
      customer_acceptance: {
        type: "online",
        accepted_at: Date.now(),
        online: {ip_address: "", user_agent: "atoa-cli"}
      }
    },
    payment_method_data: {
      type: "bacs_debit",
      bacs_debit: {type: "bacs_debit", account_number: fields.accountNumber, sort_code: fields.sortCode},
      billing_details: {
        address: {
          city: fields.city,
          country: "GB",
          // Spaces stripped: a stored postcode never contains one.
          postal_code: fields.postalCode?.replace(/\s+/g, ""),
          state: "UK",
          line1: fields.addressLine1,
          line2: fields.addressLine2
        },
        email: fields.email,
        name: fields.name
      }
    },
    // Always a fresh mandate: an existing one is refused before we get here.
    updateBacs: false
  };
  if (bankCode != null) body.bankCode = bankCode;
  return body;
}

function toFlag(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}
