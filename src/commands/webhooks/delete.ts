import {defineCommand} from "citty";
import {confirm} from "@inquirer/prompts";
import {withCommonArgs, runWithSdkKey, type CommonOptions} from "../_common";

type DeleteArgs = CommonOptions & {id?: string};

export default defineCommand({
  meta: {name: "delete", description: "Delete a merchant webhook (prompts unless --yes)"},
  args: withCommonArgs({
    id: {type: "positional", required: true, description: "webhookId"}
  }),
  run: runWithSdkKey<DeleteArgs>(async (ctx, args) => {
    const id = args.id as string;
    const path = `/api/webhook/${encodeURIComponent(id)}/merchant`;

    if (ctx.dryRun) {
      ctx.print({method: "DELETE", path});
      return;
    }

    if (!ctx.yes) {
      const ok = await confirm({message: `Delete webhook ${id}?`});
      if (!ok) {
        process.stdout.write("Aborted.\n");
        return;
      }
    }

    const {data} = await ctx.http.request({method: "DELETE", path, auth: "sdk"});
    ctx.print(data);
  })
});
