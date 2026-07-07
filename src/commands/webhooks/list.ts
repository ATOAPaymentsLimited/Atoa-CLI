import {defineCommand} from "citty";
import {withCommonArgs, runWithSdkKey} from "../_common";

export default defineCommand({
  meta: {name: "list", description: "List registered merchant webhooks"},
  args: withCommonArgs({}),
  run: runWithSdkKey(async (ctx) => {
    if (ctx.dryRun) {
      ctx.print({method: "GET", path: "/api/webhook/merchant"});
      return;
    }
    const {data} = await ctx.http.request({method: "GET", path: "/api/webhook/merchant", auth: "sdk"});
    ctx.print(data);
  })
});
