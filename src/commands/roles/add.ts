import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {isInteractive} from "../../lib/output";
import {resolveField} from "../../lib/prompt-field";
import {validateRoleName} from "../../lib/validators";
import t from "../../locales/en.json";
import {fetchAllPages} from "../../lib/list-view";
import {pickPermissionIds, resolvePermissionIds, withUpgradeHint, parseRepeatedFlag, projectRole} from "./_shared";
import type {CommandContext} from "../../lib/context";

type RolesCreateArgs = CommonOptions & {
  name?: string;
  description?: string;
  permission?: string | string[];
};

export default defineCommand({
  meta: {name: "add", description: "Add a new custom role for this business"},
  args: withCommonArgs({
    name: {type: "string", description: "role name"},
    description: {type: "string", description: "role description"},
    permission: {type: "string", description: "permission ID to grant (repeatable; from `atoa permissions list`)"}
  }),
  run: runWithContext<RolesCreateArgs>(async (ctx, args, rawArgs) => {
    const interactive = isInteractive(ctx.formatExplicit);
    let name = args.name?.trim();
    let description = args.description?.trim();
    let permissionIds = parseRepeatedFlag(rawArgs, "--permission");

    // Role names must be unique, so existing ones are read up front and the clash reported
    // here rather than as an opaque backend rejection after the fact. Skipped under --dryRun:
    // that flag promises no request is sent. The backend stays the authority either way.
    const taken = ctx.dryRun ? new Set<string>() : await existingRoleNames(ctx);
    const rule = (v: string): true | string => {
      const verdict = validateRoleName(v);
      if (verdict !== true) return verdict;
      return !taken.has(v.trim().toLowerCase()) || t.roleNameAlreadyExists;
    };

    name = await resolveField({
      value: name,
      flag: "name",
      message: t.labelRoleName,
      rule,
      interactive
    });
    if (!description && interactive) {
      const {input} = await import("@inquirer/prompts");
      description = (await input({message: t.labelRoleDescription})).trim() || undefined;
    }

    if (interactive && permissionIds.length === 0) {
      permissionIds = await pickPermissionIds(ctx);
    } else if (permissionIds.length > 0 && !ctx.dryRun) {
      // Flags get the same prerequisite closure the picker applies.
      permissionIds = await resolvePermissionIds(ctx, permissionIds);
    }

    const body: Record<string, unknown> = {name};
    if (description) body["description"] = description;
    if (permissionIds.length > 0) body["permissionIds"] = permissionIds;

    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.roles.create, body});
      return;
    }

    try {
      const {data} = await ctx.http.request({...V1_ROUTES.roles.create, body});
      ctx.print(projectRole((data ?? {}) as never));
    } catch (err) {
      throw withUpgradeHint(err);
    }
  })
});

/** Lower-cased existing role names, for the dashboard's case-insensitive duplicate check. */
async function existingRoleNames(ctx: CommandContext): Promise<Set<string>> {
  try {
    const rows = (await fetchAllPages(ctx, V1_ROUTES.roles.list)) as Array<{name?: string}>;
    return new Set(rows.map((r) => r.name?.trim().toLowerCase()).filter(Boolean) as string[]);
  } catch {
    // A failed lookup must not block role creation — the backend is still the authority.
    return new Set();
  }
}
