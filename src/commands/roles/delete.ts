import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {fetchAllPages} from "../../lib/list-view";
import {isInteractive} from "../../lib/output";
import {AtoaError} from "../../lib/errors";
import {t} from "../../lib/i18n";

type RolesDeleteArgs = CommonOptions & {roleId?: string};

interface RoleRow {
  id?: string;
  name?: string;
}

export default defineCommand({
  meta: {name: "delete", description: t("cmdRolesDelete")},
  args: withCommonArgs({
    roleId: {type: "positional", required: false, description: t("argRoleIdOptional")}
  }),
  run: runWithContext<RolesDeleteArgs>(async (ctx, args) => {
    const interactive = isInteractive(ctx.formatExplicit);
    let roleId = args.roleId?.trim();
    let display: string | undefined;

    if (!roleId) {
      if (!interactive) throw new AtoaError(t("roleIdRequiredNonInteractive"), "validation");
      const rows = (await fetchAllPages(ctx, V1_ROUTES.roles.list)) as RoleRow[];
      const picked = await pickRole(rows);
      roleId = picked.id;
      display = picked.name;
    }

    if (!ctx.yes) {
      if (!interactive) {
        throw new AtoaError(t("passYesToDeleteRole"), "validation");
      }
      const {confirm} = await import("@inquirer/prompts");
      const ok = await confirm({message: `Delete role "${display ?? roleId}"?`, default: false});
      if (!ok) return;
    }

    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.roles.delete, pathParams: {roleId}});
      return;
    }
    // Backend rejects with 409 when the role is still assigned to users — surfaced
    // via AtoaError as-is, no special-casing needed.
    const {data} = await ctx.http.request({...V1_ROUTES.roles.delete, pathParams: {roleId}});
    ctx.print(data ?? {deleted: roleId});
  })
});

async function pickRole(rows: RoleRow[]): Promise<{id: string; name: string}> {
  if (rows.length === 0) throw new AtoaError(t("noRolesFound"), "not_found");
  const {select} = await import("@inquirer/prompts");
  const picked = await select<{id: string; name: string}>({
    message: t("selectRoleToDelete"),
    pageSize: 12,
    choices: rows.map((r) => ({name: r.name ?? t("unnamedRole"), value: {id: r.id ?? "", name: r.name ?? r.id ?? ""}}))
  });
  if (!picked.id) throw new AtoaError(t("noRoleSelected"), "validation");
  return picked;
}
