import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {fetchAllPages, presentList} from "../../lib/list-view";
import {STORES_PAGE_SIZE} from "../../lib/constants";

export default defineCommand({
  meta: {name: "list", description: "List merchant stores"},
  args: withCommonArgs({}),
  run: runWithContext<CommonOptions>(async (ctx) => {
    if (ctx.dryRun) {
      ctx.print(V1_ROUTES.stores.list);
      return;
    }

    // fetchAllPages unwraps the paginated envelope and pages through it.
    const rows = await fetchAllPages(ctx, V1_ROUTES.stores.list, {}, STORES_PAGE_SIZE);
    await presentList(ctx, rows, {
      title: "Stores",
      line: (s) =>
        [s["locationName"] || "(unnamed)", s["addressPostalCode"], s["cityOrTown"]].filter(Boolean).join("  ·  ")
    });
  })
});
