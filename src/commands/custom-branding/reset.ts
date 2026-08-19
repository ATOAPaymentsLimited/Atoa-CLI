import {defineCommand} from "citty";
import {t} from "../../lib/i18n";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";

export default defineCommand({
  meta: {name: "reset", description: t("cmdCustomBrandingReset")},
  args: withCommonArgs({}),
  run: runWithContext<CommonOptions>(async (ctx) => {
    const body = {theme: {colorCode: ""}};
    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.options.update, body});
      return;
    }
    const {data} = await ctx.http.request({...V1_ROUTES.options.update, body});
    const options = (data ?? {}) as {theme?: {colorCode?: string}};
    ctx.print({colorCode: options.theme?.colorCode || undefined});
  })
});
