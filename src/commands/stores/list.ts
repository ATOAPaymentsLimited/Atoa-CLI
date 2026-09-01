import {defineCommand} from "citty";
import {t} from "../../lib/i18n";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {fetchAllPages, presentList} from "../../lib/list-view";
import {STORES_PAGE_SIZE} from "../../lib/constants";
import {projectStore, type StoreRow} from "./_shared";

export default defineCommand({
  meta: {name: "list", description: t("cmdStoresList")},
  args: withCommonArgs({}),
  run: runWithContext<CommonOptions>(async (ctx) => {
    if (ctx.dryRun) {
      ctx.print(V1_ROUTES.stores.list);
      return;
    }

    // fetchAllPages unwraps the paginated envelope and pages through it. Projected before
    // display so the drill-in detail shows the same tidy shape as the summary, rather than the
    // raw record with its nested bank account and image list.
    const rows = (await fetchAllPages(ctx, V1_ROUTES.stores.list, {}, STORES_PAGE_SIZE)).map((r) =>
      projectStore(r as StoreRow)
    );
    await presentList(ctx, rows, {
      title: t("titleStores"),
      line: (s) =>
        [s["locationName"] || "(unnamed)", s["addressPostalCode"], s["cityOrTown"]].filter(Boolean).join("  ·  ")
    });
  })
});
