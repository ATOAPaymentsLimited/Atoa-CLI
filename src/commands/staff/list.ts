import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {fetchAllPages, presentList} from "../../lib/list-view";

export default defineCommand({
  meta: {name: "list", description: "List staff members for this business"},
  args: withCommonArgs({}),
  run: runWithContext<CommonOptions>(async (ctx) => {
    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.staff.list});
      return;
    }
    // Returns Pagination<BusinessToUserEntity>; name/email come from the nested `user`
    // relation and the role name from the nested `role` relation.
    const rows = await fetchAllPages(ctx, V1_ROUTES.staff.list);
    await presentList(ctx, rows, {
      title: "Staff",
      line: (s) => {
        const user = (s["user"] ?? {}) as {firstName?: string; lastName?: string; email?: string};
        const role = s["role"] as {name?: string} | undefined;
        const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ");
        return [fullName || user.email, user.email, role?.name].filter(Boolean).join("  ·  ");
      }
    });
  })
});
