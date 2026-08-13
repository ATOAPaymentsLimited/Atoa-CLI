import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {AtoaError} from "../../lib/errors";

export default defineCommand({
  meta: {name: "status", description: "Show Google Business Profile review-connection status"},
  args: withCommonArgs({}),
  run: runWithContext<CommonOptions>(async (ctx) => {
    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.googleReview.config});
      return;
    }
    try {
      const {data} = await ctx.http.request({...V1_ROUTES.googleReview.config});
      ctx.print(data ?? {connected: false});
    } catch (err) {
      if (err instanceof AtoaError && err.status === 404) {
        ctx.print({connected: false});
        return;
      }
      throw err;
    }
  })
});
