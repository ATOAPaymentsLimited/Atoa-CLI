import {defineCommand} from "citty";
import {input, confirm, select} from "@inquirer/prompts";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import type {CommandContext} from "../../lib/context";
import {V1_ROUTES} from "../../lib/v1-routes";
import {AtoaError} from "../../lib/errors";
import {BackendErrorCode} from "../../lib/enums";
import {t} from "../../lib/i18n";
import {isInteractive, renderKeyValues} from "../../lib/output";
import {withOtp} from "../../lib/otp";
import {resolveField} from "../../lib/prompt-field";
import {
  validateSortCode,
  validateBankAccountNumber,
  normaliseSortCode,
  normaliseAccountNumber
} from "../../lib/validators";

/** The only company type whose bank account is held in the business's name rather than a person's. */
const COMPANY_LTD = "company_ltd";

type BankAddArgs = CommonOptions & {
  bankName?: string;
  sortCode?: string;
  accountNumber?: string;
  accountHolderName?: string;
  nickName?: string;
  currency?: string;
  setPrimary?: boolean;
  confirmPayeeName?: boolean;
  otp?: string;
};

/** Subset of the /api/institutions response we use. */
interface BankInstitution {
  id: string;
  name?: string;
  fullName?: string;
  bankName?: string;
  bankCode?: string;
  enabled?: boolean;
}

export default defineCommand({
  meta: {
    name: "add",
    description: t("cmdBankAdd")
  },
  // Flags are optional: omitted fields are prompted for in a terminal. Pass them to script the
  // command in a non-interactive shell (the OTP step still needs a TTY).
  args: withCommonArgs({
    bankName: {type: "string", description: t("argBankName")},
    sortCode: {type: "string", description: t("argSortCodePrompted")},
    accountNumber: {type: "string", description: t("argAccountNumberPrompted")},
    accountHolderName: {type: "string", description: t("argAccountHolderNamePrompted")},
    nickName: {type: "string", description: t("argNickName")},
    currency: {type: "string", description: t("argCurrency")},
    setPrimary: {type: "boolean", description: t("argSetPrimary")},
    confirmPayeeName: {type: "boolean", description: t("argConfirmPayeeName")},
    otp: {type: "string", description: t("argOtp")}
  }),
  run: runWithContext<BankAddArgs>(async (ctx, args) => {
    // stdout, not stdin: a prompt renders to stdout, so `--output json > file` in a terminal would
    // draw the question into the file and leave the user staring at a silent shell. Each field now
    // reports itself missing by name instead of one blanket "this command is interactive".
    const tty = isInteractive(ctx.formatExplicit);

    const body = await collectAccountFields(ctx, args, tty);

    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.bank.add, body});
      return;
    }

    // OTP 2-step: the first POST triggers an OTP; withOtp prompts for it and re-sends to verify.
    // resolveRetry handles Confirmation-of-Payee: if the name is a close (not exact) match the
    // backend asks to confirm the bank's registered name before completing (confirmFuzzyCheck).
    const {data, otpUsed} = await withOtp(ctx.http, {
      send: V1_ROUTES.bank.add,
      body,
      otp: args.otp,
      onOtpSent: () => process.stderr.write(t("otpSentToContact")),
      resolveRetry: async (err) => {
        if (err.errorCode !== BackendErrorCode.COP_VERIFIED_WITH_FUZZY_MATCH) return null;
        const registered = (err.additionalData?.["fuzzyName"] as string) || t("theNameYourBankHolds");
        const entered =
          (err.additionalData?.["registeredName"] as string) || (body["accountHolderName"] as string) || "";
        if (entered) process.stderr.write(t("accountNameDiffers", {entered}));

        // Pre-authorised, or asked — never assumed. Throwing instead would look like the safer
        // default, but the OTP has already been verified by the time this runs, so it would spend
        // a live code on a yes/no. Accepting the bank's name cannot misroute anything: sort code
        // and account number decide where the money lands, the name is only the check against it.
        if (args.confirmPayeeName) return {confirmFuzzyCheck: true};
        if (!tty) throw new AtoaError(t("copConfirmRequired", {registered}), "validation");

        const ok = await confirm({
          message: t("useBankRegisteredName", {registered}),
          default: false
        });
        return ok ? {confirmFuzzyCheck: true} : null;
      }
    });
    if (otpUsed) process.stderr.write(t("otpVerified"));

    if (!isInteractive(ctx.formatExplicit)) {
      ctx.print(data);
      return;
    }

    const acct = (data ?? {}) as Record<string, unknown>;
    const str = (v: unknown): string | undefined => (v === null || v === undefined || v === "" ? undefined : String(v));
    process.stdout.write(
      renderKeyValues(t("titleBankAccountAdded"), [
        [t("labelBank"), str(acct.bankName)],
        [t("labelAccount"), str(acct.maskedAccountNumber)],
        [t("labelSortCode"), str(acct.sortCode)],
        [t("labelNickname"), str(acct.nickName)],
        [t("labelCopCheck"), str(acct.copVerified)],
        [t("labelId"), str(acct.id)]
      ]) + "\n"
    );
  })
});

/**
 * Resolves the bank: `--bank-name` wins; otherwise fetch the supported institutions and let
 * the user pick. Returns the name + code to send.
 */
async function pickBank(
  ctx: CommandContext,
  args: BankAddArgs,
  tty: boolean
): Promise<{bankName: string; bankCode?: string}> {
  if (args.bankName?.trim()) return {bankName: args.bankName.trim()};

  // Checked before the fetch: the institution list exists only to be picked from, so with nobody
  // to pick it is a wasted round trip followed by the same failure. Named like every other missing
  // flag rather than a bare "bank name is required".
  if (!tty) throw new AtoaError(t("flagRequired", {flag: "bank-name"}), "validation");

  let banks: BankInstitution[] = [];
  try {
    const {data} = await ctx.http.request({...V1_ROUTES.institutions.list});
    const raw = (Array.isArray(data) ? data : (data as {data?: unknown})?.data) ?? [];
    banks = (raw as BankInstitution[]).filter((b) => b && b.enabled !== false);
  } catch {
    banks = []; // fall back to free-text entry below if the list can't be fetched
  }

  if (tty && banks.length) {
    const chosen = await select<BankInstitution>({
      message: t("labelBank"),
      pageSize: 12,
      choices: banks.map((b) => ({name: b.fullName || b.name || b.bankName || b.id, value: b}))
    });
    // Only send a REAL bankCode (never the institution id): the backend builds a UK IBAN from
    // `${bankCode}${sortCode}${accountNumber}` and validates it, so a bogus code fails validation.
    // When the institution has no bankCode (e.g. a test bank), omit it — non-prod derives the IBAN
    // from sort code + account number alone.
    return {
      bankName: chosen.bankName || chosen.name || chosen.fullName || chosen.id,
      bankCode: chosen.bankCode || undefined
    };
  }

  // Reached only on a terminal (guarded above), so the empty case here is a blank answer.
  const typed = (await input({message: t("labelBankName")})).trim();
  if (!typed) throw new AtoaError(t("bankNameRequired"), "validation");
  return {bankName: typed};
}

/** Resolves each field from its flag or an interactive prompt, returns the POST body. */
async function collectAccountFields(
  ctx: CommandContext,
  args: BankAddArgs,
  tty: boolean
): Promise<Record<string, unknown>> {
  const {bankName, bankCode} = await pickBank(ctx, args, tty);

  // Same digits-only, exact-length rule as direct-debit's account fields — shared in
  // validators.ts so the two commands can't drift apart. Normalised on the way out: the rule
  // accepts "12-34-56", the backend does not.
  const sortCode = normaliseSortCode(
    await resolveField({
      value: args.sortCode,
      flag: "sort-code",
      message: t("promptSortCode"),
      rule: validateSortCode,
      interactive: tty
    })
  );

  const accountNumber = normaliseAccountNumber(
    await resolveField({
      value: args.accountNumber,
      flag: "account-number",
      message: t("promptAccountNumber"),
      rule: validateBankAccountNumber,
      interactive: tty
    })
  );

  // Confirm the account number on interactive entry — a typo guard.
  if (tty && !args.accountNumber) {
    const reEntered = (await input({message: t("reEnterAccountNumber")})).trim();
    if (reEntered !== accountNumber) throw new AtoaError(t("accountNumbersDoNotMatch"), "validation");
  }

  // Prefilled with the legal business name — press Enter to accept, or type over it for an
  // account held in a different name.
  const accountHolderName =
    args.accountHolderName?.trim() ||
    (tty
      ? (
          await input({
            message: t("labelAccountHolderName"),
            default: await defaultHolderName(ctx)
          })
        ).trim()
      : "") ||
    undefined;

  const setAsPrimary =
    args.setPrimary ?? (tty ? await confirm({message: t("setAsPrimaryAccount"), default: false}) : false);

  // Currency is always GBP and nickname isn't prompted; both stay overridable via flags for scripting.
  const currency = (args.currency || "GBP").toUpperCase();
  const nickName = args.nickName?.trim() || undefined;

  return {
    bankName,
    sortCode,
    accountNumber,
    currency,
    ...(bankCode ? {bankCode} : {}),
    ...(accountHolderName ? {accountHolderName} : {}),
    ...(nickName ? {nickName} : {}),
    ...(setAsPrimary ? {setAsPrimary: true} : {})
  };
}

/**
 * Best-effort prefill for the account holder name: a limited company's account is held in its legal
 * name, anyone else's in their own. Getting this wrong is not cosmetic — the name is what
 * Confirmation of Payee is matched against.
 *
 * An unset company type falls back to the person's name rather than assuming a company; absence is
 * not evidence of one, and the prompt stays editable either way.
 *
 * One request covers it: this route returns the signed-in user alongside the business.
 */
async function defaultHolderName(ctx: CommandContext): Promise<string | undefined> {
  try {
    const {data} = await ctx.http.request({...V1_ROUTES.onboarding.getBusiness});
    const {user, business} = (data ?? {}) as {
      user?: {firstName?: string; lastName?: string};
      business?: {businessInfo?: {legalBusinessName?: string; companyType?: string}};
    };

    const {legalBusinessName, companyType} = business?.businessInfo ?? {};
    // Stored uppercase (COMPANY_LTD), compared lowercase.
    if (legalBusinessName?.trim() && companyType?.toLowerCase().includes(COMPANY_LTD)) {
      return legalBusinessName.trim();
    }

    return [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || undefined;
  } catch {
    return undefined;
  }
}
