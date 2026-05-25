import {defineCommand} from "citty";
import {confirm} from "@inquirer/prompts";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";

type CancelArgs = CommonOptions & {id?: string};

export default defineCommand({
  meta: {name: "cancel", description: "Cancel a payment request"},
  args: withCommonArgs({
    id: {type: "positional", required: true, description: "payment request ID"}
  }),
  run: runWithContext<CancelArgs>(async (ctx, args) => {
    const id = args.id as string;

    if (ctx.dryRun) {
      ctx.print({method: "POST", path: `/api/payment-request/cancel/${encodeURIComponent(id)}`});
      return;
    }

    if (!ctx.yes) {
      const ok = await confirm({message: `Cancel payment ${id}?`});
      if (!ok) {
        process.stdout.write("Aborted.\n");
        return;
      }
    }

    const {data} = await ctx.http.request({
      method: "POST",
      path: "/api/payment-request/cancel/:id",
      pathParams: {id}
    });
    ctx.print(data);
  })
});
