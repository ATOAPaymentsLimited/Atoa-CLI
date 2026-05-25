import {defineCommand} from "citty";
import {confirm} from "@inquirer/prompts";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";

type CaptureArgs = CommonOptions & {id?: string};

export default defineCommand({
  meta: {name: "capture", description: "Capture a previously authorized card-on-file payment"},
  args: withCommonArgs({
    id: {type: "positional", required: true, description: "paymentRequestId from prior charge"}
  }),
  run: runWithContext<CaptureArgs>(async (ctx, args) => {
    const id = args.id as string;
    const path = `/api/payments/card/payment-request/${encodeURIComponent(id)}/capture`;

    if (ctx.dryRun) {
      ctx.print({method: "POST", path});
      return;
    }

    if (!ctx.yes) {
      const ok = await confirm({message: `Capture payment ${id}?`});
      if (!ok) {
        process.stdout.write("Aborted.\n");
        return;
      }
    }

    const {data} = await ctx.http.request({method: "POST", path});
    ctx.print(data);
  })
});
