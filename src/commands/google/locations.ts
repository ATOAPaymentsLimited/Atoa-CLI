import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {t} from "../../lib/i18n";

export default defineCommand({
  meta: {name: "locations", description: t("cmdGoogleLocations")},
  args: withCommonArgs({}),
  run: runWithContext<CommonOptions>(async (ctx) => {
    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.google.linkedLocations});
      return;
    }

    const {data} = await ctx.http.request({...V1_ROUTES.google.linkedLocations});
    ctx.print(data);
  })
});
