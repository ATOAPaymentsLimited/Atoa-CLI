import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../../_common";
import {V1_ROUTES} from "../../../lib/v1-routes";
import {isInteractive} from "../../../lib/output";
import {AtoaError} from "../../../lib/errors";

type SubmitArgs = CommonOptions & {
  paymentType?: string;
  website?: string;
  vat?: string;
  avgFulfilmentDays?: string;
  maxTransactionAmount?: string;
};

const PAYMENT_TYPES = ["IN_STORE", "ONLINE", "BOTH"] as const;

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

    let website = args.website?.trim();
    let vat = args.vat?.trim();
    let avgFulfilmentDays = args.avgFulfilmentDays?.trim();
    let maxTransactionAmount = args.maxTransactionAmount?.trim();

    const anyFieldMissing =
      !paymentType ||
      args.website === undefined ||
      args.vat === undefined ||
      args.avgFulfilmentDays === undefined ||
      args.maxTransactionAmount === undefined;

    if (anyFieldMissing) {
      if (!isInteractive(ctx.formatExplicit)) {
        if (!paymentType) throw new AtoaError("--payment-type is required (non-interactive)", "validation");
      } else {
        const {select, input} = await import("@inquirer/prompts");
        if (!paymentType) {
          paymentType = await select({
            message: "Where does this business take payments?",
            choices: [
              {name: "In-store", value: "IN_STORE"},
              {name: "Online", value: "ONLINE"},
              {name: "Both", value: "BOTH"}
            ]
          });
        }
        if (args.website === undefined) {
          website = (await input({message: "Business website (optional, enter to skip):"})).trim() || undefined;
        }
        if (args.vat === undefined) {
          vat = (await input({message: "VAT registration number (optional, enter to skip):"})).trim() || undefined;
        }
        if (args.avgFulfilmentDays === undefined) {
          avgFulfilmentDays =
            (
              await input({
                message: "Average order fulfilment time in days (optional, enter to skip):",
                validate: (v) => !v || /^\d+$/.test(v) || "enter a whole number of days"
              })
            ).trim() || undefined;
        }
        if (args.maxTransactionAmount === undefined) {
          maxTransactionAmount =
            (
              await input({
                message: "Maximum transaction amount in GBP (optional, enter to skip):",
                validate: (v) => !v || /^\d+(\.\d{1,2})?$/.test(v) || "enter a number, e.g. 250 or 250.00"
              })
            ).trim() || undefined;
        }
      }
    }

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
