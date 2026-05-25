import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {AtoaError} from "../../lib/errors";

type CreateArgs = CommonOptions & {
  amount?: string;
  orderId?: string;
  redirectUrl?: string;
  customerId?: string;
  storeId?: string;
  paymentMethod?: string;
  savePaymentMethod?: boolean;
  atoaCustomerId?: string;
  autoRedirect?: boolean;
  consumerDetails?: string;
  callbackParams?: string;
  expiresIn?: string;
  notes?: string;
  enableTips?: boolean;
  allowRetry?: boolean;
  splitBill?: boolean;
  template?: string;
  idempotencyKey?: string;
};

export default defineCommand({
  meta: {name: "create", description: "Create a payment request"},
  args: withCommonArgs({
    amount: {type: "string", required: true, description: "amount in pounds, e.g. 10.50 for £10.50 (minimum £1)"},
    orderId: {type: "string", required: true, description: "merchant order reference"},
    redirectUrl: {type: "string", description: "redirect URL after payment (optional)"},

    customerId: {type: "string", description: "saved Atoa customer ID"},
    storeId: {type: "string", description: "store ID"},
    paymentMethod: {type: "string", description: "comma-separated payment methods (PAY_BY_BANK, CARD)"},
    savePaymentMethod: {
      type: "boolean",
      description:
        "save card on file for future charges. Requires --atoaCustomerId and --paymentMethod=CARD; cannot combine with --splitBill"
    },
    atoaCustomerId: {
      type: "string",
      description: "Atoa-specific customer ID (required when --savePaymentMethod is set)"
    },
    autoRedirect: {type: "boolean", description: "auto-redirect after payment completes"},
    consumerDetails: {
      type: "string",
      description:
        'consumer details as JSON. Fields: firstName, lastName, email, phoneCountryCode, phoneNumber. ' +
        'E.g. \'{"firstName":"Jane","lastName":"Doe","email":"jane@example.com","phoneCountryCode":"44","phoneNumber":"7700900000"}\''
    },
    callbackParams: {
      type: "string",
      description: 'callback params as JSON e.g. \'{"couponCode":"245561","refId":"2342"}\' — appended to the redirect URL as query params'
    },
    expiresIn: {type: "string", description: "payment link expiry in milliseconds (default 180000 = 3 minutes)"},
    notes: {type: "string", description: "free-text notes attached to the payment"},
    enableTips: {type: "boolean", description: "show tipping UI on the payment page"},
    allowRetry: {type: "boolean", description: "allow the payer to retry on failure"},
    splitBill: {type: "boolean", description: "enable split-bill mode"},
    template: {
      type: "string",
      description: "QR template: EXTERNAL_DISPLAY | EXTERNAL_DISPLAY_PNG | RECEIPT | RECEIPT_PNG"
    },
    idempotencyKey: {
      type: "string",
      description: "override the auto-generated Idempotency-Key (e.g. CI dedup keyed off $RUN_ID)"
    }
  }),
  run: runWithContext<CreateArgs>(async (ctx, args) => {
    const amount = Number(args.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new AtoaError("--amount must be a positive finite number", "validation");
    }

    let consumerDetails: Record<string, unknown> | undefined;
    if (args.consumerDetails) {
      try {
        consumerDetails = JSON.parse(args.consumerDetails) as Record<string, unknown>;
      } catch {
        throw new AtoaError("--consumerDetails must be valid JSON", "validation");
      }
    }

    let callbackParams: Record<string, unknown> | undefined;
    if (args.callbackParams) {
      try {
        callbackParams = JSON.parse(args.callbackParams) as Record<string, unknown>;
      } catch {
        throw new AtoaError("--callbackParams must be valid JSON", "validation");
      }
    }

    let expiresIn: number | undefined;
    if (args.expiresIn !== undefined) {
      const parsed = Number(args.expiresIn);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new AtoaError("--expiresIn must be a positive finite number (milliseconds)", "validation");
      }
      expiresIn = parsed;
    }

    const body = {
      amount,
      orderId: args.orderId as string,
      ...(args.redirectUrl && {redirectUrl: args.redirectUrl}),
      ...(args.customerId && {customerId: args.customerId}),
      ...(args.storeId && {storeId: args.storeId}),
      ...(args.paymentMethod && {paymentMethod: args.paymentMethod.split(",").map((s) => s.trim())}),
      ...(args.savePaymentMethod === true && {savePaymentMethod: true}),
      ...(args.atoaCustomerId && {atoaCustomerId: args.atoaCustomerId}),
      ...(args.autoRedirect === true && {autoRedirect: true}),
      ...(consumerDetails && {consumerDetails}),
      ...(callbackParams && {callbackParams}),
      ...(expiresIn !== undefined && {expiresIn}),
      ...(args.notes && {notes: args.notes}),
      ...(args.enableTips === true && {enableTips: true}),
      ...(args.allowRetry === true && {allowRetry: true}),
      ...(args.splitBill === true && {splitBill: true}),
      ...(args.template && {template: args.template})
    };

    if (ctx.dryRun) {
      ctx.print({
        method: "POST",
        path: "/api/payments/process-payment",
        body,
        idempotencyKey: args.idempotencyKey ?? "(auto-generated UUIDv4)"
      });
      return;
    }

    const {data} = await ctx.http.request({
      method: "POST",
      path: "/api/payments/process-payment",
      body,
      idempotencyKey: args.idempotencyKey
    });
    ctx.print(data);
  })
});
