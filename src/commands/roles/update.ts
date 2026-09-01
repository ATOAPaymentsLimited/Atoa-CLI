import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {fetchAllPages} from "../../lib/list-view";
import {isInteractive} from "../../lib/output";
import {AtoaError} from "../../lib/errors";
import {
  pickPermissionIds,
  resolvePermissionIds,
  withUpgradeHint,
  parseRepeatedFlag,
  projectRole,
  type RoleRow as RoleWithPermissionNames
} from "./_shared";
import {resolveField} from "../../lib/prompt-field";
import {validateRoleName} from "../../lib/validators";
import {t} from "../../lib/i18n";

type RolesUpdateArgs = CommonOptions & {
  roleId?: string;
  name?: string;
  description?: string;
  permission?: string | string[];
};

interface RoleWithPermissionIds {
  id?: string;
  name?: string;
  description?: string;
  /** Grants arrive as join rows wrapping the permission — the id lives on the inner record. */
  rolePermissions?: Array<{permission?: {id?: string}}>;
}

const permissionIdsOf = (role: RoleWithPermissionIds): string[] =>
  (role.rolePermissions ?? []).map((rp) => rp.permission?.id).filter((id): id is string => Boolean(id));

const sameSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

export default defineCommand({
  meta: {name: "update", description: t("cmdRolesUpdate")},
  args: withCommonArgs({
    roleId: {type: "positional", required: false, description: t("argRoleIdOptional")},
    name: {type: "string", description: t("argNewRoleName")},
    description: {type: "string", description: t("argNewRoleDescription")},
    permission: {
      type: "string",
      description: t("argPermissionIdReplaces")
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
    const rows = (await fetchAllPages(ctx, V1_ROUTES.roles.list)) as RoleWithPermissionIds[];

    if (!roleId) {
      if (!interactive) throw new AtoaError(t("argRequiredNonInteractive", {arg: "roleId"}), "validation");
      roleId = await pickRoleId(rows);
    }

    const existing = rows.find((r) => r.id === roleId);
    if (!existing) throw new AtoaError(t("noRoleWithId", {roleId}), "not_found");

    const existingPermissionIds = permissionIdsOf(existing);

    // On a TTY each field is offered with its current value already filled in, so the role can
    // be edited in place — press Enter to keep a value, type over it to change one.
    let name = args.name?.trim() || existing.name;
    let description = args.description?.trim() ?? existing.description;
    if (interactive && !args.name) {
      name = await resolveField({
        value: undefined,
        flag: "name",
        message: t("labelRoleName"),
        rule: validateRoleName,
        interactive,
        default: existing.name
      });
    }
    if (interactive && args.description === undefined) {
      const {input} = await import("@inquirer/prompts");
      description = (await input({message: t("labelRoleDescription"), default: existing.description})).trim();
    }
    if (!name) throw new AtoaError(t("roleNameIsRequired"), "validation");

    if (!permissionsTouched && interactive) {
      permissionIds = await pickPermissionIds(ctx, existingPermissionIds);
      permissionsTouched = true; // explicit selection, even if the user picked none
    } else if (permissionsTouched && !ctx.dryRun) {
      permissionIds = await resolvePermissionIds(ctx, permissionIds);
    }

    // Nothing to send if nothing moved — an update that changes no field is a wasted write and
    // a misleading "updated" in the output.
    const nameChanged = name !== existing.name;
    const descriptionChanged = (description || "") !== (existing.description || "");
    const permissionsChanged = permissionsTouched && !sameSet(permissionIds, existingPermissionIds);
    if (!nameChanged && !descriptionChanged && !permissionsChanged) {
      ctx.print({status: t("noChanges"), role: existing.name});
      return;
    }

    const body: Record<string, unknown> = {name};
    // Keyed on the change, not on truthiness: `if (description)` dropped the field when clearing
    // it, so the backend kept the old text while the CLI reported the update as applied.
    if (descriptionChanged) body["description"] = description || "";
    if (permissionsTouched) body["permissionIds"] = permissionIds;

    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.roles.update, pathParams: {roleId}, body});
      return;
    }

    try {
      const {data} = await ctx.http.request({...V1_ROUTES.roles.update, pathParams: {roleId}, body});
      ctx.print(projectRole((data ?? {}) as RoleWithPermissionNames));
    } catch (err) {
      throw withUpgradeHint(err);
    }
  })
});

async function pickRoleId(rows: RoleWithPermissionIds[]): Promise<string> {
  if (rows.length === 0) throw new AtoaError(t("noRolesFound"), "not_found");
  const {select} = await import("@inquirer/prompts");
  const roleId = await select<string>({
    message: t("selectRoleToUpdate"),
    pageSize: 12,
    choices: rows.map((r) => ({name: r.name ?? t("unnamedRole"), value: r.id ?? ""}))
  });
  if (!roleId) throw new AtoaError(t("noRoleSelected"), "validation");
  return roleId;
}
