import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {fetchAllPages} from "../../lib/list-view";
import {isInteractive} from "../../lib/output";
import {AtoaError} from "../../lib/errors";
import type {CommandContext} from "../../lib/context";
import {t} from "../../lib/i18n";

type StaffRemoveArgs = CommonOptions & {userId?: string};

export default defineCommand({
  meta: {name: "delete", description: t("cmdStaffDelete")},
  args: withCommonArgs({
    userId: {
      type: "positional",
      required: false,
      description: t("argStaffUserId")
    }
  }),
  run: runWithContext<StaffRemoveArgs>(async (ctx, args) => {
    const interactive = isInteractive(ctx.formatExplicit);
    let userId = args.userId?.trim();
    let display: string | undefined;

    if (!userId) {
      if (!interactive) throw new AtoaError(t("argRequiredNonInteractive", {arg: "userId"}), "validation");
      const picked = await pickStaffMember(ctx);
      userId = picked.id;
      display = picked.display;
    }

    if (!ctx.yes) {
      if (!interactive) {
        throw new AtoaError(t("passYesToRemove"), "validation");
      }
      const {confirm} = await import("@inquirer/prompts");
      const ok = await confirm({message: t("confirmRemoveStaff", {name: display ?? userId}), default: false});
      if (!ok) return;
    }

    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.staff.remove, pathParams: {userId}});
      return;
    }
    // Backend returns a clean {success, message} even for the "cannot remove
    // self/last admin" case — surfaced as-is via AtoaError, no special-casing needed.
    await ctx.http.request({...V1_ROUTES.staff.remove, pathParams: {userId}});
    ctx.print({removed: userId});
  })
});

/**
 * Picks a staff member, returning their **user** id.
 *
 * A staff row carries two ids: `id` is the business-user link, `user.id` is the person. The
 * delete route keys on the person — it refuses when the caller's own id matches — so sending
 * the link id targets nothing and the self-deletion guard can never fire.
 */
async function pickStaffMember(ctx: CommandContext): Promise<{id: string; display: string}> {
  const rows = (await fetchAllPages(ctx, V1_ROUTES.staff.list)) as Array<{
    id?: string;
    user?: {id?: string; firstName?: string; lastName?: string; email?: string};
  }>;
  if (rows.length === 0) throw new AtoaError(t("noStaffFound"), "not_found");

  const {select} = await import("@inquirer/prompts");
  const picked = await select<{id: string; display: string}>({
    message: t("selectStaffToRemove"),
    pageSize: 12,
    choices: rows.map((s) => {
      const fullName = [s.user?.firstName, s.user?.lastName].filter(Boolean).join(" ");
      const display = fullName || s.user?.email || s.user?.id || t("unknown");
      return {name: display, value: {id: s.user?.id ?? "", display}};
    })
  });
  if (!picked.id) throw new AtoaError(t("noStaffSelected"), "validation");
  return picked;
}
