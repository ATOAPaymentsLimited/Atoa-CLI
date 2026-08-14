import {defineCommand} from "citty";
import {withCommonArgs, runWithContext} from "../../_common";
import {V1_ROUTES} from "../../../lib/v1-routes";
import {isInteractive, renderKeyValues} from "../../../lib/output";
import {AtoaError} from "../../../lib/errors";

interface CardActivationStatus {
  status?: string;
  paymentType?: string;
  rejectReason?: string;
}

export default defineCommand({
  meta: {name: "status", description: "Check card-payment activation status"},
  args: withCommonArgs({}),
  run: runWithContext(async (ctx) => {
    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.cardActivation.status});
      return;
    }

    let card: CardActivationStatus;
    try {
      const {data} = await ctx.http.request({...V1_ROUTES.cardActivation.status});
      card = (data ?? {}) as CardActivationStatus;
    } catch (err) {
      // Backend 404s rather than returning a "none" status before a merchant has ever
      // applied. NOT_INITIATED is client-side only — it deliberately matches the name the
      // dashboard already uses for this same synthesised state (its CardApplicationStatus
      // enum), so CLI and dashboard don't report the same condition under two names.
      // Only the backend's own "no application" 404 means NOT_INITIATED. Matching every 404
      // would turn a stale businessId, a routing mistake or a gateway 404 into "you haven't
      // applied yet" — telling a merchant with a pending or rejected application to re-apply.
      if (err instanceof AtoaError && err.kind === "not_found" && isNoApplication(err)) {
        card = {status: "NOT_INITIATED"};
      } else {
        throw err;
      }
    }

    if (!isInteractive(ctx.formatExplicit)) {
      ctx.print(card);
      return;
    }

    const rows: Array<[string, string | undefined]> = [
      ["Status", card.status],
      ["Payment type", card.paymentType],
      ["Reject reason", card.rejectReason]
    ];
    process.stdout.write(renderKeyValues("Card-payment activation", rows) + "\n");
  })
});

/**
 * Distinguishes the backend's "this business has no card application" 404 from any other 404.
 * It responds with errorCode/name NOT_FOUND and a message naming the card application; a
 * gateway or wrong-path 404 carries neither, so those keep surfacing as real errors.
 */
function isNoApplication(err: AtoaError): boolean {
  return /card application/i.test(err.message ?? "");
}
