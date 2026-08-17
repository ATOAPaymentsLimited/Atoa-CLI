import {defineCommand} from "citty";
import {withCommonArgs, runWithContext} from "../../_common";
import {V1_ROUTES} from "../../../lib/v1-routes";
import {isInteractive, renderKeyValues} from "../../../lib/output";
import {AtoaError} from "../../../lib/errors";
import {fetchKybStatus} from "../_shared";

interface CardActivationStatus {
  status?: string;
  paymentType?: string;
  rejectReason?: string;
}

/** The KYB states that block card activation — see commands/kyb/_shared.ts. */
const KYB_BLOCKS_CARD = ["PENDING", "REJECTED"];

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
      // platform already uses for this same synthesised state, so one condition is not
      // reported under two names.
      // Only the backend's own "no application" 404 means NOT_INITIATED. Matching every 404
      // would turn a stale businessId, a routing mistake or a gateway 404 into "you haven't
      // applied yet" — telling a merchant with a pending or rejected application to re-apply.
      if (err instanceof AtoaError && err.kind === "not_found" && isNoApplication(err)) {
        card = {status: "NOT_INITIATED"};
      } else {
        throw err;
      }
    }

    // Card activation is gated on KYB, so the card status alone doesn't explain a merchant who
    // can't proceed — NOT_INITIATED reads as "you haven't applied" when the real answer is
    // "you can't yet". Best-effort: a card status is still worth printing if this call fails.
    const kybStatus = await fetchKybStatus(ctx).catch(() => undefined);
    const kybBlocking = Boolean(kybStatus && KYB_BLOCKS_CARD.includes(kybStatus));

    if (!isInteractive(ctx.formatExplicit)) {
      ctx.print({...card, kybStatus});
      return;
    }

    const rows: Array<[string, string | undefined]> = [
      ["Status", card.status],
      ["Payment type", card.paymentType],
      ["Reject reason", card.rejectReason],
      ["KYB status", kybStatus],
      ["Blocked by", kybBlocking ? "business verification — run `atoa kyb link` to complete it" : undefined]
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
