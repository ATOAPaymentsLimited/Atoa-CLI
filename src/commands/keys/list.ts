import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {parseEnvFlag} from "../../lib/env";
import {fetchAllPages, presentList} from "../../lib/list-view";

export default defineCommand({
  meta: {
    name: "list",
    description: "List SDK keys for this account. Never shows secrets."
  },
  args: withCommonArgs({}),
  run: runWithContext<CommonOptions>(async (ctx, args) => {
    const env = parseEnvFlag(args.env);
    const rows = await fetchAllPages(ctx, V1_ROUTES.apiKeys.list, {env});

    await presentList(ctx, rows, {
      title: "API keys",
      line: (k) =>
        [k["name"] || k["label"] || k["id"], k["environment"] || k["env"], k["id"]].filter(Boolean).join("  ·  ")
    });
  })
});
