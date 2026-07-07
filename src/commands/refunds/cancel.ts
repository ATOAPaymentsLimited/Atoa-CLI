import {defineCommand} from "citty";
import {confirm} from "@inquirer/prompts";
import {withCommonArgs, runWithSdkKey, type CommonOptions} from "../_common";

type CancelArgs = CommonOptions & {id?: string};

export default defineCommand({
  meta: {name: "cancel", description: "Cancel a refund still in INITIATED status"},
  args: withCommonArgs({
    id: {type: "positional", required: true, description: "refundId"}
  }),
  run: runWithSdkKey<CancelArgs>(async (ctx, args) => {
    const id = args.id as string;
    const path = `/api/refund/${encodeURIComponent(id)}/cancel`;

    if (ctx.dryRun) {
      ctx.print({method: "DELETE", path});
      return;
    }

    if (!ctx.yes) {
      const ok = await confirm({message: `Cancel refund ${id}?`});
      if (!ok) {
        process.stdout.write("Aborted.\n");
        return;
      }
    }

    const {data} = await ctx.http.request({method: "DELETE", path});
    ctx.print(data);
  })
});
