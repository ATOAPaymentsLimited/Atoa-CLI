import {defineCommand} from "citty";
import {confirm} from "@inquirer/prompts";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";

type CancelArgs = CommonOptions & {
  id?: string;
  reasonCode?: string;
  reasonDescription?: string;
};

export default defineCommand({
  meta: {name: "cancel", description: "Cancel a previously authorized card-on-file payment"},
  args: withCommonArgs({
    id: {type: "positional", required: true, description: "paymentRequestId from prior charge"},
    reasonCode: {
      type: "string",
      description: 'cancelledReasonCode: "Duplicate" | "Abandoned" | "Requested by customer" | "Other"'
    },
    reasonDescription: {
      type: "string",
      description: "cancelledReasonDescription (free text; required when --reasonCode=Other)"
    }
  }),
  run: runWithContext<CancelArgs>(async (ctx, args) => {
    const id = args.id as string;
    const path = `/api/payments/card/payment-request/${encodeURIComponent(id)}/cancel`;
    const body = {
      ...(args.reasonCode && {cancelledReasonCode: args.reasonCode}),
      ...(args.reasonDescription && {cancelledReasonDescription: args.reasonDescription})
    };
    const bodyToSend = Object.keys(body).length > 0 ? body : undefined;

    if (ctx.dryRun) {
      ctx.print({method: "POST", path, body: bodyToSend});
      return;
    }

    if (!ctx.yes) {
      const ok = await confirm({message: `Cancel card payment ${id}?`});
      if (!ok) {
        process.stdout.write("Aborted.\n");
        return;
      }
    }

    const {data} = await ctx.http.request({method: "POST", path, body: bodyToSend});
    ctx.print(data);
  })
});
