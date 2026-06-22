import {defineCommand} from "citty";
import {confirm} from "@inquirer/prompts";
import {withCommonArgs, runWithSdkKey, type CommonOptions} from "../_common";

type DeleteArgs = CommonOptions & {id?: string};

export default defineCommand({
  meta: {name: "delete", description: "Delete a customer (prompts unless --yes)"},
  args: withCommonArgs({
    id: {type: "positional", required: true, description: "customer ID"}
  }),
  run: runWithSdkKey<DeleteArgs>(async (ctx, args) => {
    const id = args.id as string;
    const path = `/api/customers/${encodeURIComponent(id)}`;

    if (ctx.dryRun) {
      ctx.print({method: "DELETE", path});
      return;
    }

    if (!ctx.yes) {
      const ok = await confirm({message: `Delete customer ${id}? This cannot be undone.`});
      if (!ok) {
        process.stdout.write("Aborted.\n");
        return;
      }
    }

    const {data} = await ctx.http.request({method: "DELETE", path});
    ctx.print(data);
  })
});
