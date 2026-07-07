import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {fetchAllPages, presentList} from "../../lib/list-view";

export default defineCommand({
  meta: {name: "list", description: "List available roles for this business"},
  args: withCommonArgs({}),
  run: runWithContext<CommonOptions>(async (ctx) => {
    if (ctx.dryRun) {
      ctx.print(V1_ROUTES.roles.list);
      return;
    }

    // fetchAllPages unwraps the Pagination envelope and pages through it.
    const rows = await fetchAllPages(ctx, V1_ROUTES.roles.list);
    await presentList(ctx, rows, {
      title: "Roles",
      line: (r) => [r["name"], r["roleScopeType"], r["description"]].filter(Boolean).join("  ·  ")
    });
  })
});
