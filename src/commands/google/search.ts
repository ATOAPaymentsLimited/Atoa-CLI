import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {AtoaError} from "../../lib/errors";
import {t} from "../../lib/i18n";
import {projectPlace, type GooglePlace} from "./_shared";

type SearchArgs = CommonOptions & {text?: string};

export default defineCommand({
  meta: {name: "search", description: t("cmdGoogleSearch")},
  args: withCommonArgs({
    text: {type: "positional", required: true, description: t("argGoogleSearchText")}
  }),
  run: runWithContext<SearchArgs>(async (ctx, args) => {
    const text = args.text?.trim();
    if (!text) throw new AtoaError(t("googleSearchTextRequired"), "validation");

    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.google.searchLocations, query: {text}});
      return;
    }

    const {data} = await ctx.http.request({...V1_ROUTES.google.searchLocations, query: {text}});
    ctx.print((Array.isArray(data) ? data : []).map((p) => projectPlace(p as GooglePlace)));
  })
});
