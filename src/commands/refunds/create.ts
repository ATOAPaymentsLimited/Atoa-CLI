import {defineCommand} from "citty";
import {confirm} from "@inquirer/prompts";
import {withCommonArgs, runWithSdkKey, type CommonOptions} from "../_common";
import {AtoaError} from "../../lib/errors";

type CreateArgs = CommonOptions & {
  paymentRequestId?: string;
  amount?: string;
  currency?: string;
  notes?: string;
  reason?: string;
  idempotencyKey?: string;
};

export default defineCommand({
  meta: {name: "create", description: "Create a refund for a payment request"},
  args: withCommonArgs({
    paymentRequestId: {type: "string", required: true, description: "paymentRequestId to refund"},
    amount: {
      type: "string",
      required: true,
      description:
        "refund amount in pounds, e.g. 10.50 for £10.50 (minimum £1). For a full refund, pass the original transaction amount."
    },
    currency: {type: "string", description: "ISO 4217 currency code (e.g. GBP)"},
    notes: {type: "string", description: "refundNotes — free text shown on the refund record"},
    reason: {type: "string", description: "alias for --notes (refundNotes field)"},
    idempotencyKey: {
      type: "string",
      description: "override the auto-generated Idempotency-Key (e.g. CI dedup keyed off $RUN_ID)"
    }
  }),
  run: runWithSdkKey<CreateArgs>(async (ctx, args) => {
    const paymentRequestId = args.paymentRequestId as string;
    const refundNotes = args.notes ?? args.reason;

    const amount = Number(args.amount);
    if (!Number.isFinite(amount) || amount < 1) {
      throw new AtoaError("--amount must be a number >= 1", "validation");
    }

    const body = {
      paymentRequestId,
      amount,
      ...(args.currency && {currency: args.currency}),
      ...(refundNotes && {refundNotes})
    };

    if (ctx.dryRun) {
      ctx.print({
        method: "POST",
        path: "/api/refund",
        body,
        idempotencyKey: args.idempotencyKey ?? "(auto-generated UUIDv4)"
      });
      return;
    }

    if (!ctx.yes) {
      const ok = await confirm({message: `Create refund for payment ${paymentRequestId}?`});
      if (!ok) {
        process.stdout.write("Aborted.\n");
        return;
      }
    }

    const {data} = await ctx.http.request({
      method: "POST",
      path: "/api/refund",
      body,
      idempotencyKey: args.idempotencyKey
    });
    ctx.print(data);
  })
});
