import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {AtoaError} from "../../lib/errors";
import {isInteractive, renderKeyValues} from "../../lib/output";

type PaymentLinksCreateArgs = CommonOptions & {
  amount: string;
  storeId: string;
  notes?: string;
};

export default defineCommand({
  meta: {name: "create", description: "Create a payment link"},
  args: withCommonArgs({
    amount: {type: "string", required: true, description: "amount in GBP (e.g. 10 or 10.50)"},
    storeId: {type: "string", required: true, description: "store ID to create the link under"},
    notes: {type: "string", description: "optional notes for the payment link (max 30 chars)"}
  }),
  run: runWithContext<PaymentLinksCreateArgs>(async (ctx, args) => {
    // Amount is in GBP (major units) — the backend stores it in a double-precision column and the
    // dashboard sends the entered value unchanged. Accepts whole pounds or decimals (e.g. 10.50).
    const amountRaw = args.amount?.trim();
    const amount = Number(amountRaw);
    if (!amountRaw || !Number.isFinite(amount) || amount <= 0) {
      throw new AtoaError("--amount must be a number greater than 0 (GBP)", "validation");
    }

    const storeId = args.storeId?.trim();
    if (!storeId) throw new AtoaError("--store-id is required", "validation");

    const notes = args.notes?.trim();
    if (notes && notes.length > 30) {
      throw new AtoaError("--notes must not exceed 30 characters", "validation");
    }

    // A fixed-amount link that never expires (expiry is driven by an explicit expiryDate, which we
    // don't send). `source` is attribution only — appended to the payment URL as `&source=` for
    // reporting; LINK marks this as a shareable payment link. businessId is auto-filled from the
    // active profile; storeId is carried in the path.
    const body: Record<string, unknown> = {
      amount,
      paymentDetails: {source: "LINK"}
    };
    if (notes) body["notes"] = notes;

    const route = {...V1_ROUTES.payments.links.create, pathParams: {storeId}, body};

    if (ctx.dryRun) {
      ctx.print(route);
      return;
    }
    // Response is a PaymentLinks object: {id, amount, status, paymentLink, ...}.
    const {data} = await ctx.http.request(route);

    if (!isInteractive(ctx.formatExplicit)) {
      ctx.print(data);
      return;
    }

    const result = (data ?? {}) as Record<string, unknown>;
    const str = (v: unknown): string | undefined => (v === null || v === undefined || v === "" ? undefined : String(v));
    process.stdout.write(
      renderKeyValues("✓ Payment link created", [
        ["Payment link", str(result.paymentLink)],
        ["Link ID", str(result.id)],
        ["Amount", str(result.amount)],
        ["Status", str(result.status)]
      ]) + "\n"
    );
  })
});
