import {defineCommand} from "citty";
import {withCommonArgs, type CommonOptions} from "../_common";
import {buildContext, type CommandContext} from "../../lib/context";
import {AtoaError, exitCodeFor, printError} from "../../lib/errors";

type TriggerArgs = CommonOptions & {
  event?: string;
  orderId?: string;
  amount?: string;
  paymentMethod?: string;
  status?: string;
  type?: string;
  customFields?: string;
};

const VALID_EVENTS = ["PAYMENTS_STATUS", "EXPIRED_STATUS", "REFUND_STATUS", "POS_PAYMENT_STATUS"] as const;
const VALID_PAYMENT_METHODS = ["CARD", "PAY_BY_BANK"] as const;

// Local pre-flight hint only — the canonical per-event allow-list is enforced by the API.
const VALID_STATUSES = ["COMPLETED", "AUTHORIZED", "FAILED", "CANCELLED", "EXPIRED"] as const;

export default defineCommand({
  meta: {
    name: "trigger",
    description:
      "Send a test webhook event to your registered sandbox webhook URL. Uses the sandbox key for the active profile; --env is ignored."
  },
  args: withCommonArgs({
    event: {
      type: "positional",
      required: true,
      description: `event type to trigger (one of: ${VALID_EVENTS.join(" | ")})`
    },
    orderId: {type: "string", description: "override the orderId in the dispatched body"},
    amount: {type: "string", description: "override the paidAmount in pounds, e.g. 10.05 for £10.05"},
    paymentMethod: {type: "string", description: `paymentMethod field: ${VALID_PAYMENT_METHODS.join(" | ")}`},
    status: {
      type: "string",
      description: `override the dispatched body's status. Allowed values depend on the event type: ${VALID_STATUSES.join(" | ")}`
    },
    type: {
      type: "string",
      description:
        "POS_PAYMENT_STATUS only — select which body shape to dispatch (payment / refund / expired). Rejected for non-POS events."
    },
    customFields: {
      type: "string",
      description:
        "POS_PAYMENT_STATUS only — JSON array of {value, fieldName} objects, e.g. " +
        `'[{"value":"CUST_001","fieldName":"Customer ID"}]'. ` +
        "Defaults to a single-entry test fixture when omitted on a POS trigger. Rejected for non-POS events."
    }
  }),
  async run({args: cittyArgs, rawArgs = []}) {
    const args = cittyArgs as unknown as TriggerArgs;
    let ctx: CommandContext | undefined;
    try {
      const event = String(args.event ?? "").toUpperCase();
      if (!VALID_EVENTS.includes(event as (typeof VALID_EVENTS)[number])) {
        throw new AtoaError(`unknown event "${args.event}". Valid: ${VALID_EVENTS.join(", ")}`, "validation");
      }

      // Notify (don't error) when the user passed --env production. We always
      // use sandbox here — webhook test triggers are sandbox-only by design.
      if (args.env && args.env.toLowerCase() !== "sandbox") {
        process.stderr.write(
          `note: --env=${args.env} ignored. \`atoa webhooks trigger\` always uses the sandbox key.\n`
        );
      }

      // Force sandbox regardless of the active profile's default env or any
      // --env flag. We do NOT call runWithContext here because that respects
      // the user's env preference; this command intentionally overrides it.
      try {
        ctx = await buildContext({...args, env: "sandbox"});
      } catch (err) {
        const ae = err as AtoaError;
        if (ae.kind === "auth" && /No credentials/i.test(ae.message)) {
          throw new AtoaError(
            `no sandbox key stored for the active profile. \`atoa webhooks trigger\` always uses the sandbox key — \`atoa login\` (paste).`,
            "auth"
          );
        }
        throw err;
      }

      let paymentMethod: string | undefined;
      if (args.paymentMethod) {
        const pm = args.paymentMethod.toUpperCase();
        if (!VALID_PAYMENT_METHODS.includes(pm as (typeof VALID_PAYMENT_METHODS)[number])) {
          throw new AtoaError(
            `unknown paymentMethod "${args.paymentMethod}". Valid: ${VALID_PAYMENT_METHODS.join(", ")}`,
            "validation"
          );
        }
        paymentMethod = pm;
      }

      // Status pre-check — generic enum-membership only. The per-event +
      // per-paymentMethod rules (e.g. AUTHORIZED is CARD-only, EXPIRED_STATUS
      // ignores user input) are enforced by the API.
      let status: string | undefined;
      if (args.status) {
        const s = args.status.toUpperCase();
        if (!VALID_STATUSES.includes(s as (typeof VALID_STATUSES)[number])) {
          throw new AtoaError(`unknown status "${args.status}". Valid: ${VALID_STATUSES.join(", ")}`, "validation");
        }
        status = s;
      }

      const posType = args.type?.toUpperCase();

      let customFields: unknown[] | undefined;
      if (args.customFields !== undefined) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(args.customFields);
        } catch (err) {
          throw new AtoaError(
            `--customFields must be a JSON array, parse failed: ${(err as Error).message}`,
            "validation"
          );
        }
        if (!Array.isArray(parsed)) {
          throw new AtoaError(`--customFields must be a JSON array, got ${typeof parsed}`, "validation");
        }
        customFields = parsed;
      }

      const body: Record<string, unknown> = {eventType: event};
      if (args.orderId) body.orderId = args.orderId;
      if (args.amount !== undefined) {
        const n = Number(args.amount);
        if (!Number.isFinite(n) || n < 0) {
          throw new AtoaError(`--amount must be a non-negative number, got "${args.amount}"`, "validation");
        }
        body.amount = n;
      }
      if (paymentMethod) body.paymentMethod = paymentMethod;
      if (status) body.status = status;
      if (posType) body.type = posType;
      if (customFields) body.customFields = customFields;

      const path = `/api/webhook/test`;
      if (ctx.dryRun) {
        ctx.print({method: "POST", path, body});
        return;
      }

      const {data} = await ctx.http.request({method: "POST", path, body});

      const msg = (data as {message?: unknown} | null)?.message;
      if (typeof msg === "string") {
        process.stdout.write(msg + "\n");
      } else {
        ctx.print(data);
      }
    } catch (err) {
      printError(err);
      process.exitCode = exitCodeFor((err as AtoaError).kind);
    }
    // unused param suppression
    void rawArgs;
  }
});
