import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {AtoaError} from "../../lib/errors";
import {isInteractive, renderKeyValues} from "../../lib/output";

type PaymentLinksGetArgs = CommonOptions & {id: string; storeId: string};

export default defineCommand({
  meta: {name: "get", description: "Fetch a payment link by id (shows its status)"},
  args: withCommonArgs({
    id: {type: "positional", required: true, description: "payment link id"},
    storeId: {type: "string", required: true, description: "store ID the link belongs to"}
  }),
  run: runWithContext<PaymentLinksGetArgs>(async (ctx, args) => {
    const id = args.id?.trim();
    if (!id) throw new AtoaError("payment link id is required", "validation");
    const storeId = args.storeId?.trim();
    if (!storeId) throw new AtoaError("--store-id is required", "validation");

    // businessId is auto-filled from the active profile; storeId + linkId are carried in the path.
    const route = {...V1_ROUTES.payments.links.get, pathParams: {storeId, linkId: id}};

    if (ctx.dryRun) {
      ctx.print(route);
      return;
    }
    // Response is a PaymentLinks object: {id, amount, status, paymentLink, expiryDate, ...}.
    const {data} = await ctx.http.request(route);

    if (!isInteractive(ctx.formatExplicit)) {
      ctx.print(data);
      return;
    }

    const result = (data ?? {}) as Record<string, unknown>;
    const str = (v: unknown): string | undefined => (v === null || v === undefined || v === "" ? undefined : String(v));
    process.stdout.write(
      renderKeyValues("Payment link", [
        ["Link ID", str(result.id)],
        ["Status", str(result.status)],
        ["Amount", str(result.amount)],
        ["Payment link", str(result.paymentLink)],
        ["Expiry date", str(result.expiryDate)]
      ]) + "\n"
    );
  })
});
