import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {AtoaError} from "../../lib/errors";
import {isInteractive, renderKeyValues} from "../../lib/output";

type PaymentLinksCreateArgs = CommonOptions & {
  amount: string;
  currency?: string;
  notes?: string;
};

export default defineCommand({
  meta: {name: "create", description: "Create a payment link (amount in pence)"},
  args: withCommonArgs({
    amount: {type: "string", required: true, description: "amount in pence (integer >= 1)"},
    currency: {type: "string", description: "ISO currency code (default GBP)"},
    notes: {type: "string", description: "optional notes for the payment link (max 30 chars)"}
  }),
  run: runWithContext<PaymentLinksCreateArgs>(async (ctx, args) => {
    const amountRaw = args.amount?.trim();
    const amount = parseInt(amountRaw, 10);
    if (!amountRaw || isNaN(amount) || amount < 1) {
      throw new AtoaError("--amount must be a number >= 1 (pence)", "validation");
    }

    const notes = args.notes?.trim();
    if (notes && notes.length > 30) {
      throw new AtoaError("--notes must not exceed 30 characters", "validation");
    }

    // The merchant generate-payment-link endpoint accepts the "generateLink" group: amount,
    // currency, source and notes. `source` is LINK for a shareable payment link.
    const body: Record<string, unknown> = {
      amount,
      currency: (args.currency || "GBP").toUpperCase(),
      source: "LINK"
    };
    if (notes) body["notes"] = notes;

    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.payments.links.create, body});
      return;
    }
    // Response is a ProcessPaymentQrResponse: {qrCodeUrl, paymentUrl, paymentRequestId}.
    const {data} = await ctx.http.request({...V1_ROUTES.payments.links.create, body});

    if (!isInteractive(ctx.formatExplicit)) {
      ctx.print(data);
      return;
    }

    const result = (data ?? {}) as Record<string, unknown>;
    const str = (v: unknown): string | undefined => (v === null || v === undefined || v === "" ? undefined : String(v));
    process.stdout.write(
      renderKeyValues("✓ Payment link created", [
        ["Payment URL", str(result.paymentUrl)],
        ["QR code URL", str(result.qrCodeUrl)],
        ["Payment request ID", str(result.paymentRequestId)]
      ]) + "\n"
    );
  })
});
