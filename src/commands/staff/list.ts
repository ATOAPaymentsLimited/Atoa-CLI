import {defineCommand} from "citty";
import {t} from "../../lib/i18n";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {fetchAllPages, presentList} from "../../lib/list-view";
import {projectStaff} from "./_shared";

export default defineCommand({
  meta: {name: "list", description: t("cmdStaffList")},
  args: withCommonArgs({}),
  run: runWithContext<CommonOptions>(async (ctx) => {
    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.staff.list});
      return;
    }
    // Projected before display so the drill-in detail shows the same tidy shape as the summary,
    // rather than the raw record with its nested relations.
    const rows = (await fetchAllPages(ctx, V1_ROUTES.staff.list)).map((r) => projectStaff(r as never));
    await presentList(ctx, rows, {
      title: "Staff",
      line: (s) => [s["name"], s["email"], s["role"]].filter(Boolean).join("  ·  ")
    });
  })
});
