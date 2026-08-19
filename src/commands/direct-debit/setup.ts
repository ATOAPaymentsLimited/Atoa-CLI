import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {isInteractive} from "../../lib/output";
import {AtoaError} from "../../lib/errors";
import {resolveField, type FieldRule} from "../../lib/prompt-field";
import {
  RULES,
  fetchPrefillSources,
  prefillFor,
  describeAccount,
  maskAccountNumber,
  fetchAssignedPlan,
  hasActiveMandate,
  type DirectDebitPrefill,
  type BankAccount
} from "./_shared";
import {t} from "../../lib/i18n";
import type {CommandContext} from "../../lib/context";

type Field = "accountNumber" | "sortCode" | "name" | "email" | "addressLine1" | "addressLine2" | "city" | "postalCode";

/** Collected by a bespoke masked prompt rather than the shared loop below. */
const ACCOUNT_NUMBER: Field = "accountNumber";

type DirectDebitSetupArgs = CommonOptions & Partial<Record<Field, string>>;

/**
 * Prompt order, label, rule and optionality in one table. Split across separate lists, omitting
 * a field from the required one would silently make it optional; here the type forces all four.
 */
interface FieldSpec {
  key: Field;
  label: string;
  rule: FieldRule;
  optional?: boolean;
}

const FIELDS: FieldSpec[] = [
  {key: "accountNumber", label: t("labelAccountNumber"), rule: RULES.accountNumber},
  {key: "sortCode", label: t("labelSortCode"), rule: RULES.sortCode},
  {key: "name", label: t("labelNameOnAccount"), rule: RULES.name},
  {key: "email", label: t("labelEmailAddress"), rule: RULES.email},
  {key: "addressLine1", label: t("labelAddressLine1"), rule: RULES.addressLine1},
  {key: "addressLine2", label: t("labelAddressLine2Optional"), rule: RULES.addressLine2, optional: true},
  {key: "city", label: t("labelTownCity"), rule: RULES.city},
  {key: "postalCode", label: t("labelPostalCode"), rule: RULES.postalCode}
];

export default defineCommand({
  meta: {
    name: "setup",
    description: t("cmdDirectDebitSetup")
  },
  args: withCommonArgs({
    accountNumber: {type: "string", description: t("argDdAccountNumber")},
    sortCode: {type: "string", description: t("argDdSortCode")},
    name: {type: "string", description: t("argDdNameOnAccount")},
    email: {type: "string", description: t("argDdEmail")},
    addressLine1: {type: "string", description: t("argDdAddressLine1")},
    addressLine2: {type: "string", description: t("argDdAddressLine2")},
    city: {type: "string", description: t("argDdCity")},
    postalCode: {type: "string", description: t("argDdPostalCode")}
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
 * Picks the account to pre-fill from; account number, sort code and bank code all follow that
 * choice. With none on file the bank comes from the institution list, setting the bank code only.
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
    message: t("labelBankAccount"),
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
      message: t("labelBank"),
      pageSize: 12,
      choices: [
        ...usable.map((b) => ({
          name: [b.fullName || b.name, b.businessBank ? t("bankTypeBusiness") : t("bankTypePersonal")]
            .filter(Boolean)
            .join("  ·  "),
          value: b.bankCode
        })),
        {name: t("optionSkip"), value: undefined}
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

  for (const {key, label, rule, optional} of FIELDS) {
    // Collected above, by its own masked prompt.
    if (key === ACCOUNT_NUMBER) continue;
    fields[key] = await resolveField({
      value: args[key],
      flag: toFlag(key),
      message: label,
      rule,
      interactive,
      optional,
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
        message: `${t("labelAccountNumber")} (${masked} ${t("onFilePressEnterToKeep")})`,
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
    message: t("labelAccountNumber"),
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
      message: t("confirmAccountNumberPrompt"),
      validate: (v) => v.trim() === accountNumber || t("accountNumbersDoNotMatch")
    })
  ).trim();
  if (again !== accountNumber) throw new AtoaError(t("accountNumbersDoNotMatch"), "validation");
}

/**
 * Refuses to set up a second mandate. Changing the bank a mandate debits is a Direct Debit
 * amendment, not a re-run of setup, so it is deliberately not offered here.
 */
async function assertNoActiveMandate(ctx: CommandContext): Promise<void> {
  const plan = await fetchAssignedPlan(ctx);
  if (!hasActiveMandate(plan)) return;

  const status = plan?.stripeCustomer?.mandateDetails?.status;
  throw new AtoaError(t("mandateAlreadySetUp", {status: status ? ` (status: ${status})` : ""}), "validation");
}

/**
 * Mandate acceptance, asked as the last question before the mandate is created. Answering no
 * stops the run — the mandate cannot be set up without it.
 */
async function assertMandateAccepted(interactive: boolean): Promise<void> {
  if (!interactive) return;
  const {confirm} = await import("@inquirer/prompts");
  const accepted = await confirm({message: t("mandateAcceptTerms"), default: true});
  if (!accepted) throw new AtoaError(t("mandateNotAccepted"), "validation");
}

/**
 * GB/UK are fixed rather than collected, and `accepted_at` is milliseconds, as every other
 * caller of this endpoint sends.
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
