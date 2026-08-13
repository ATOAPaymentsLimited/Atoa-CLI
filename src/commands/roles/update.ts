import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {fetchAllPages} from "../../lib/list-view";
import {isInteractive} from "../../lib/output";
import {AtoaError} from "../../lib/errors";
import {pickPermissionIds, withUpgradeHint, parseRepeatedFlag} from "./_shared";

type RolesUpdateArgs = CommonOptions & {
  roleId?: string;
  name?: string;
  description?: string;
  permission?: string | string[];
};

interface RoleRow {
  id?: string;
  name?: string;
  description?: string;
  permissions?: Array<{id?: string}>;
}

export default defineCommand({
  meta: {name: "update", description: "Update an existing custom role"},
  args: withCommonArgs({
    roleId: {type: "positional", required: false, description: "role ID (omit to pick from the role list on a TTY)"},
    name: {type: "string", description: "new role name"},
    description: {type: "string", description: "new role description"},
    permission: {
      type: "string",
      description:
        "permission ID to grant (repeatable; replaces the role's full permission set — omit to leave unchanged)"
    }
  }),
  run: runWithContext<RolesUpdateArgs>(async (ctx, args, rawArgs) => {
    const interactive = isInteractive(ctx.formatExplicit);
    let roleId = args.roleId?.trim();
    let permissionIds = parseRepeatedFlag(rawArgs, "--permission");
    // Distinguishes "no --permission flags given, leave unchanged" from "user
    // explicitly selected zero permissions" — the backend removes ALL permissions
    // when `permissionIds` is an empty array, but leaves them untouched when the
    // field is omitted entirely. Only the latter is safe to default to.
    let permissionsTouched = permissionIds.length > 0;

    // There is no CLI-accessible GET /:roleId, so prefill data comes from the list
    // rather than an extra per-role fetch.
    const rows = (await fetchAllPages(ctx, V1_ROUTES.roles.list)) as RoleRow[];

    if (!roleId) {
      if (!interactive) throw new AtoaError("roleId is required (non-interactive)", "validation");
      roleId = await pickRoleId(rows);
    }

    const existing = rows.find((r) => r.id === roleId);
    if (!existing) throw new AtoaError(`no role found with id ${roleId}`, "not_found");

    const name = args.name?.trim() || existing.name;
    const description = args.description?.trim() ?? existing.description;
    if (!name) throw new AtoaError("role name is required", "validation");

    if (!permissionsTouched && interactive) {
      const existingPermissionIds = (existing.permissions ?? [])
        .map((p) => p.id)
        .filter((id): id is string => Boolean(id));
      permissionIds = await pickPermissionIds(ctx, existingPermissionIds);
      permissionsTouched = true; // explicit selection, even if the user picked none
    }

    const body: Record<string, unknown> = {name};
    if (description) body["description"] = description;
    if (permissionsTouched) body["permissionIds"] = permissionIds;

    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.roles.update, pathParams: {roleId}, body});
      return;
    }

    try {
      const {data} = await ctx.http.request({...V1_ROUTES.roles.update, pathParams: {roleId}, body});
      ctx.print(data);
    } catch (err) {
      throw withUpgradeHint(err);
    }
  })
});

async function pickRoleId(rows: RoleRow[]): Promise<string> {
  if (rows.length === 0) throw new AtoaError("no roles found for this business", "not_found");
  const {select} = await import("@inquirer/prompts");
  const roleId = await select<string>({
    message: "Select a role to update",
    pageSize: 12,
    choices: rows.map((r) => ({name: r.name ?? "(unnamed role)", value: r.id ?? ""}))
  });
  if (!roleId) throw new AtoaError("no role selected", "validation");
  return roleId;
}
