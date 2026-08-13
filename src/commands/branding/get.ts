import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";

export default defineCommand({
  meta: {name: "get", description: "Get the checkout page theme colour for this business"},
  args: withCommonArgs({}),
  run: runWithContext<CommonOptions>(async (ctx) => {
    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.options.get});
      return;
    }
    const {data} = await ctx.http.request({...V1_ROUTES.options.get});
    const options = (data ?? {}) as {theme?: {colorCode?: string; foregroundColor?: string}};
    ctx.print({
      colorCode: options.theme?.colorCode || undefined,
      foregroundColor: options.theme?.foregroundColor || undefined
    });
  })
});
