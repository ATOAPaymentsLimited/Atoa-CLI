import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {fetchAllPages} from "../../lib/list-view";
import {isInteractive} from "../../lib/output";
import {AtoaError} from "../../lib/errors";
import type {CommandContext} from "../../lib/context";

type StaffRemoveArgs = CommonOptions & {userId?: string};

export default defineCommand({
  meta: {name: "remove", description: "Remove a staff member's access to this business"},
  args: withCommonArgs({
    userId: {
      type: "positional",
      required: false,
      description: "business-user ID (omit to pick from the staff list on a TTY)"
    }
  }),
  run: runWithContext<StaffRemoveArgs>(async (ctx, args) => {
    const interactive = isInteractive(ctx.formatExplicit);
    let userId = args.userId?.trim();
    let display: string | undefined;

    if (!userId) {
      if (!interactive) throw new AtoaError("userId is required (non-interactive)", "validation");
      const picked = await pickStaffMember(ctx);
      userId = picked.id;
      display = picked.display;
    }

    if (!ctx.yes) {
      if (!interactive) {
        throw new AtoaError("pass --yes to remove without a confirmation prompt (non-interactive)", "validation");
      }
      const {confirm} = await import("@inquirer/prompts");
      const ok = await confirm({message: `Remove ${display ?? userId} from this business?`, default: false});
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

async function pickStaffMember(ctx: CommandContext): Promise<{id: string; display: string}> {
  const rows = (await fetchAllPages(ctx, V1_ROUTES.staff.list)) as Array<{
    id?: string;
    user?: {firstName?: string; lastName?: string; email?: string};
  }>;
  if (rows.length === 0) throw new AtoaError("no staff found for this business", "not_found");

  const {select} = await import("@inquirer/prompts");
  const picked = await select<{id: string; display: string}>({
    message: "Select a staff member to remove",
    pageSize: 12,
    choices: rows.map((s) => {
      const fullName = [s.user?.firstName, s.user?.lastName].filter(Boolean).join(" ");
      const display = fullName || s.user?.email || s.id || "(unknown)";
      return {name: display, value: {id: s.id ?? "", display}};
    })
  });
  if (!picked.id) throw new AtoaError("no staff member selected", "validation");
  return picked;
}
