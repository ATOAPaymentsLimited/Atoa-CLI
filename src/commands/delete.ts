import {defineCommand} from "citty";
import {confirm} from "@inquirer/prompts";
import {withCommonArgs, runWithContext, type CommonOptions} from "./_common";

type DeleteArgs = CommonOptions & {path?: string};

export default defineCommand({
  meta: {name: "delete", description: "Send a DELETE request (prompts for confirmation)"},
  args: withCommonArgs({
    path: {type: "positional", required: true, description: "/api/path/:param"}
  }),
  run: runWithContext<DeleteArgs>(async (ctx, args) => {
    const path = args.path as string;

    if (ctx.dryRun) {
      ctx.print({method: "DELETE", url: ctx.http.baseUrl + path});
      return;
    }

    if (!ctx.yes) {
      const ok = await confirm({message: `DELETE ${path}? This cannot be undone.`});
      if (!ok) {
        process.stdout.write("Aborted.\n");
        return;
      }
    }

    const {data} = await ctx.http.request({method: "DELETE", path});
    ctx.print(data);
  })
});
