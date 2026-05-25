import {defineCommand} from "citty";
import {withCommonArgs, runWithContext} from "../_common";

export default defineCommand({
  meta: {name: "list", description: "List available payment institutions (banks)"},
  args: withCommonArgs({}),
  run: runWithContext(async (ctx) => {
    if (ctx.dryRun) {
      ctx.print({method: "GET", path: "/api/institutions"});
      return;
    }
    const {data} = await ctx.http.request({method: "GET", path: "/api/institutions"});
    ctx.print(data);
  })
});
