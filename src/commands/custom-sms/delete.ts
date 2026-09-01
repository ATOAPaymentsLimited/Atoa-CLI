import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {AtoaError} from "../../lib/errors";
import {fetchCustomSenderName} from "./_shared";
import {t} from "../../lib/i18n";

export default defineCommand({
  meta: {name: "delete", description: t("cmdCustomSmsDelete")},
  args: withCommonArgs({}),
  run: runWithContext<CommonOptions>(async (ctx) => {
    const existing = await fetchCustomSenderName(ctx);
    if (!existing?.id) throw new AtoaError(t("noCustomSmsNameSet"), "not_found");

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
