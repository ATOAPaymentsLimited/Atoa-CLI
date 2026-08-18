import {defineCommand} from "citty";
import {input, confirm, select} from "@inquirer/prompts";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import type {CommandContext} from "../../lib/context";
import {V1_ROUTES} from "../../lib/v1-routes";
import {AtoaError} from "../../lib/errors";
import {BackendErrorCode} from "../../lib/enums";
import {isInteractive, renderKeyValues} from "../../lib/output";
import {withOtp} from "../../lib/otp";

type BankAddArgs = CommonOptions & {
  bankName?: string;
  sortCode?: string;
  accountNumber?: string;
  accountHolderName?: string;
  nickName?: string;
  currency?: string;
  setPrimary?: boolean;
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
    description: "Add a bank account. Pick the bank + enter details interactively, then verify via OTP before adding."
  },
  // Flags are optional: omitted fields are prompted for in a terminal. Pass them to script the
  // command in a non-interactive shell (the OTP step still needs a TTY).
  args: withCommonArgs({
    bankName: {type: "string", description: "bank name (otherwise picked from the institutions list)"},
    sortCode: {type: "string", description: "6-digit sort code (prompted if omitted)"},
    accountNumber: {type: "string", description: "account number (prompted if omitted)"},
    accountHolderName: {type: "string", description: "name on the account (prompted if omitted)"},
    nickName: {type: "string", description: "a label for this account (optional)"},
    currency: {type: "string", description: "ISO currency (default GBP)"},
    setPrimary: {type: "boolean", description: "set as the primary account"}
  }),
  run: runWithContext<BankAddArgs>(async (ctx, args) => {
    const tty = Boolean(process.stdin.isTTY);

    if (!tty && (!args.bankName || !args.sortCode || !args.accountNumber)) {
      throw new AtoaError(
        "bank add is interactive (it prompts for details + an OTP). In a non-interactive shell pass " +
          "--bank-name, --sort-code and --account-number.",
        "validation"
      );
    }

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
      onOtpSent: () => process.stderr.write("An OTP has been sent to your registered contact. Enter it below.\n"),
      resolveRetry: async (err) => {
        if (err.errorCode !== BackendErrorCode.COP_VERIFIED_WITH_FUZZY_MATCH) return null;
        const registered = (err.additionalData?.["fuzzyName"] as string) || "the name your bank holds";
        const entered =
          (err.additionalData?.["registeredName"] as string) || (body["accountHolderName"] as string) || "";
        if (entered) process.stderr.write(`The name on the account differs from what you entered ("${entered}").\n`);
        const ok = await confirm({
          message: `Your bank's records show "${registered}". Use that name and continue?`,
          default: false
        });
        return ok ? {confirmFuzzyCheck: true} : null;
      }
    });
    if (otpUsed) process.stderr.write("✓ OTP verified.\n");

    if (!isInteractive(ctx.formatExplicit)) {
      ctx.print(data);
      return;
    }

    const acct = (data ?? {}) as Record<string, unknown>;
    const str = (v: unknown): string | undefined => (v === null || v === undefined || v === "" ? undefined : String(v));
    process.stdout.write(
      renderKeyValues("✓ Bank account added", [
        ["Bank", str(acct.bankName)],
        ["Account", str(acct.maskedAccountNumber)],
        ["Sort code", str(acct.sortCode)],
        ["Nickname", str(acct.nickName)],
        ["CoP check", str(acct.copVerified)],
        ["ID", str(acct.id)]
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
      message: "Bank:",
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

  const typed = (tty ? await input({message: "Bank name:"}) : "").trim();
  if (!typed) throw new AtoaError("Bank name is required", "validation");
  return {bankName: typed};
}

/** Resolves each field from its flag or an interactive prompt, returns the POST body. */
async function collectAccountFields(
  ctx: CommandContext,
  args: BankAddArgs,
  tty: boolean
): Promise<Record<string, unknown>> {
  const required = async (flag: string | undefined, message: string, label: string): Promise<string> => {
    const value = (flag ?? (tty ? await input({message}) : "")).trim();
    if (!value) throw new AtoaError(`${label} is required`, "validation");
    return value;
  };

  const {bankName, bankCode} = await pickBank(ctx, args, tty);
  const sortCode = (await required(args.sortCode, "Sort code (6 digits, no spaces):", "Sort code")).replace(/\s+/g, "");
  const accountNumber = await required(args.accountNumber, "Account number (usually 8 digits):", "Account number");

  // Confirm the account number on interactive entry — a typo guard.
  if (tty && !args.accountNumber) {
    const reEntered = (await input({message: "Re-enter account number to confirm:"})).trim();
    if (reEntered !== accountNumber) throw new AtoaError("Account numbers do not match.", "validation");
  }

  // Account holder name prefills from the signed-in user's profile name — press Enter to accept.
  const accountHolderName =
    args.accountHolderName?.trim() ||
    (tty
      ? (
          await input({
            message: "Account holder name (the name as it appears on the bank account):",
            default: await defaultHolderName(ctx)
          })
        ).trim()
      : "") ||
    undefined;

  const setAsPrimary =
    args.setPrimary ??
    (tty ? await confirm({message: "Set as your primary (default) account?", default: false}) : false);

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

/** Best-effort prefill for the account holder name: the signed-in user's profile name. */
async function defaultHolderName(ctx: CommandContext): Promise<string | undefined> {
  try {
    const {data} = await ctx.http.request({...V1_ROUTES.identity.get});
    const {firstName, lastName} = (data ?? {}) as {firstName?: string; lastName?: string};
    return [firstName, lastName].filter(Boolean).join(" ") || undefined;
  } catch {
    return undefined;
  }
}
