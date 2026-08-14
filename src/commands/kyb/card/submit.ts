import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../../_common";
import {V1_ROUTES} from "../../../lib/v1-routes";
import {isInteractive} from "../../../lib/output";
import {AtoaError} from "../../../lib/errors";
import type {CommandContext} from "../../../lib/context";
import {
  validateWebsiteUrl,
  validateVatOptional,
  validateWholeNumber,
  validateAmount,
  normaliseVatNumber
} from "../../../lib/validators";

type SubmitArgs = CommonOptions & {
  paymentType?: string;
  website?: string;
  vat?: string;
  avgFulfilmentDays?: string;
  maxTransactionAmount?: string;
};

const PAYMENT_TYPES = ["IN_STORE", "ONLINE", "BOTH"] as const;

/** Turns a validator's `true | string` result into a validation error naming the flag. */
function assertFlag(result: true | string, flag: string): void {
  if (result !== true) throw new AtoaError(`${flag}: ${result}`, "validation");
}

/**
 * Validates the optional fields when supplied as flags. These previously only had a
 * `validate:` on the interactive prompt, so `--avg-fulfilment-days abc` reached Number()
 * unchecked, became NaN, and serialised to null — silently dropping the field. VAT is
 * normalised here so spacing/case ("gb 123 456 789") is accepted like the postcode prompt.
 */
function validateFlags(args: SubmitArgs): {
  website?: string;
  vat?: string;
  avgFulfilmentDays?: string;
  maxTransactionAmount?: string;
} {
  const website = args.website?.trim();
  if (website) assertFlag(validateWebsiteUrl(website), "--website");

  let vat = args.vat?.trim();
  if (vat) {
    assertFlag(validateVatOptional(vat), "--vat");
    vat = normaliseVatNumber(vat);
  }

  const avgFulfilmentDays = args.avgFulfilmentDays?.trim();
  if (avgFulfilmentDays) assertFlag(validateWholeNumber(avgFulfilmentDays), "--avg-fulfilment-days");

  const maxTransactionAmount = args.maxTransactionAmount?.trim();
  if (maxTransactionAmount) assertFlag(validateAmount(maxTransactionAmount), "--max-transaction-amount");

  return {website, vat, avgFulfilmentDays, maxTransactionAmount};
}

type Fields = {website?: string; vat?: string; avgFulfilmentDays?: string; maxTransactionAmount?: string};

/**
 * Fills anything the caller left unset. On a TTY every missing field is prompted for, reusing
 * the same validators as the flag path so both routes enforce one rule. Non-interactively only
 * paymentType is mandatory — the backend falls back to stored business info for the rest.
 */
async function promptMissing(
  ctx: CommandContext,
  args: SubmitArgs,
  paymentType: string | undefined,
  flags: Fields
): Promise<Fields & {paymentType?: string}> {
  const complete =
    paymentType &&
    args.website !== undefined &&
    args.vat !== undefined &&
    args.avgFulfilmentDays !== undefined &&
    args.maxTransactionAmount !== undefined;
  if (complete) return {...flags, paymentType};

  if (!isInteractive(ctx.formatExplicit)) {
    if (!paymentType) throw new AtoaError("--payment-type is required (non-interactive)", "validation");
    return {...flags, paymentType};
  }

  const {select, input} = await import("@inquirer/prompts");
  const out: Fields & {paymentType?: string} = {...flags, paymentType};

  if (!out.paymentType) {
    out.paymentType = await select({
      message: "Where does this business take payments?",
      choices: [
        {name: "In-store", value: "IN_STORE"},
        {name: "Online", value: "ONLINE"},
        {name: "Both", value: "BOTH"}
      ]
    });
  }
  if (args.website === undefined) {
    out.website =
      (await input({message: "Business website (optional, enter to skip):", validate: validateWebsiteUrl})).trim() ||
      undefined;
  }
  if (args.vat === undefined) {
    out.vat =
      normaliseVatNumber(
        await input({message: "VAT registration number (optional, enter to skip):", validate: validateVatOptional})
      ) || undefined;
  }
  if (args.avgFulfilmentDays === undefined) {
    out.avgFulfilmentDays =
      (
        await input({
          message: "Average order fulfilment time in days (optional, enter to skip):",
          validate: validateWholeNumber
        })
      ).trim() || undefined;
  }
  if (args.maxTransactionAmount === undefined) {
    out.maxTransactionAmount =
      (
        await input({
          message: "Maximum transaction amount in GBP (optional, enter to skip):",
          validate: validateAmount
        })
      ).trim() || undefined;
  }
  return out;
}

/**
 * Wire field names are intentionally kept as-is —
 * webSiteUrl/vatNumber/avgPurchaseFulfilmentDays/maxTransactionAmount — do not
 * "normalize" them; the backend DTO is the source of truth.
 */
export default defineCommand({
  meta: {name: "submit", description: "Submit a card-payment application for compliance review"},
  args: withCommonArgs({
    paymentType: {type: "string", description: "IN_STORE | ONLINE | BOTH"},
    website: {type: "string", description: "business website (optional)"},
    vat: {type: "string", description: "VAT registration number (optional)"},
    avgFulfilmentDays: {type: "string", description: "average order fulfilment time in days (optional)"},
    maxTransactionAmount: {type: "string", description: "maximum transaction amount in GBP (optional)"}
  }),
  run: runWithContext<SubmitArgs>(async (ctx, args) => {
    let paymentType = args.paymentType?.trim().toUpperCase();
    if (paymentType && !PAYMENT_TYPES.includes(paymentType as (typeof PAYMENT_TYPES)[number])) {
      throw new AtoaError(`--payment-type must be one of ${PAYMENT_TYPES.join(", ")}`, "validation");
    }

    const flags = validateFlags(args);

    // Anything still unset is prompted for on a TTY; non-interactively only paymentType is required.
    const {paymentType: resolvedType, ...rest} = await promptMissing(ctx, args, paymentType, flags);
    paymentType = resolvedType;
    const {website, vat, avgFulfilmentDays, maxTransactionAmount} = rest;

    const body: Record<string, unknown> = {paymentType};
    if (website) body.webSiteUrl = website;
    if (vat) body.vatNumber = vat;
    if (avgFulfilmentDays) body.avgPurchaseFulfilmentDays = Number(avgFulfilmentDays);
    if (maxTransactionAmount) body.maxTransactionAmount = Number(maxTransactionAmount);

    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.cardActivation.submit, body});
      return;
    }

    try {
      const {data} = await ctx.http.request({...V1_ROUTES.cardActivation.submit, body});
      ctx.print(data);
    } catch (err) {
      throw withDashboardHint(err);
    }
  })
});

/**
 * Submit's preconditions split in two: the field values are fixable right here via flags,
 * but missing statements and an incomplete/rejected KYB can only be resolved in the dashboard —
 * the CLI deliberately doesn't upload compliance documents. Point at `kyb card link` for those
 * so the command isn't a dead end.
 *
 * Matched on message text because the backend returns these as plain 400s that all share a
 * single generic error name — there's no stable code to branch on. If the backend's wording
 * changes the hint silently stops appearing; the underlying error still surfaces correctly.
 */
function withDashboardHint(err: unknown): unknown {
  if (!(err instanceof AtoaError) || err.kind !== "validation") return err;
  if (!/statement|kyb/i.test(err.message)) return err;

  return new AtoaError(`${err.message} — resolve this in the dashboard: run 'atoa kyb card link'`, err.kind, {
    status: err.status,
    errorCode: err.errorCode,
    requestId: err.requestId,
    additionalData: err.additionalData
  });
}
