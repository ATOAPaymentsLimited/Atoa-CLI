import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {AtoaError} from "../../lib/errors";
import {fetchCustomSenderName} from "./_shared";

export default defineCommand({
  meta: {name: "remove", description: "Remove the custom SMS sender name for this business"},
  args: withCommonArgs({}),
  run: runWithContext<CommonOptions>(async (ctx) => {
    const existing = await fetchCustomSenderName(ctx);
    if (!existing?.id) throw new AtoaError("no custom SMS sender name set for this business", "not_found");

    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.customSenderName.remove, pathParams: {customOptionId: existing.id}});
      return;
    }
    const {data} = await ctx.http.request({
      ...V1_ROUTES.customSenderName.remove,
      pathParams: {customOptionId: existing.id}
    });
    ctx.print(data ?? {removed: existing.id});
  })
});
