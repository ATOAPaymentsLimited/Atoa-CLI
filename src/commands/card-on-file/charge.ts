import {defineCommand} from "citty";
import {withCommonArgs, runWithSdkKey, type CommonOptions} from "../_common";
import {AtoaError} from "../../lib/errors";

type ChargeArgs = CommonOptions & {
  customerId?: string;
  paymentMethodId?: string;
  amount?: string;
  orderId?: string;
  captureType?: string;
  capture?: boolean;
  storeId?: string;
  notes?: string;
  idempotencyKey?: string;
};

export default defineCommand({
  meta: {name: "charge", description: "Charge a saved card on file"},
  args: withCommonArgs({
    customerId: {type: "string", required: true, description: "saved customer ID"},
    paymentMethodId: {type: "string", required: true, description: "saved card / payment method ID"},
    amount: {type: "string", required: true, description: "amount in pounds, e.g. 10.50 for £10.50 (minimum £1)"},
    orderId: {type: "string", required: true, description: "merchant order reference"},
    captureType: {
      type: "string",
      description: "AUTO_CAPTURE | MANUAL_CAPTURE | CAPTURE_BEFORE_EXPIRY (default: AUTO_CAPTURE)"
    },
    capture: {
      type: "boolean",
      description:
        "shortcut for captureType: --capture forces AUTO_CAPTURE, --no-capture forces MANUAL_CAPTURE. " +
        "For CAPTURE_BEFORE_EXPIRY, use --captureType=CAPTURE_BEFORE_EXPIRY explicitly."
    },
    storeId: {type: "string", description: "store ID"},
    notes: {type: "string", description: "free-text notes attached to the payment"},
    idempotencyKey: {
      type: "string",
      description: "override the auto-generated Idempotency-Key (e.g. CI dedup keyed off $RUN_ID)"
    }
  }),
  run: runWithSdkKey<ChargeArgs>(async (ctx, args) => {
    const captureType =
      args.captureType ??
      (args.capture === true ? "AUTO_CAPTURE" : args.capture === false ? "MANUAL_CAPTURE" : "AUTO_CAPTURE");

    const amount = Number(args.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new AtoaError("--amount must be a positive finite number", "validation");
    }

    const body = {
      customerId: args.customerId as string,
      paymentMethodId: args.paymentMethodId as string,
      captureType,
      amount,
      orderId: args.orderId as string,
      ...(args.notes && {notes: args.notes}),
      ...(args.storeId && {storeId: args.storeId})
    };

    const path = "/api/payments/card/process-payment";

    if (ctx.dryRun) {
      ctx.print({method: "POST", path, body, idempotencyKey: args.idempotencyKey ?? "(auto-generated UUIDv4)"});
      return;
    }

    const {data} = await ctx.http.request({
      method: "POST",
      path,
      body,
      idempotencyKey: args.idempotencyKey
    });
    ctx.print(data);
  })
});
