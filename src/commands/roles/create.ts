import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {isInteractive} from "../../lib/output";
import {AtoaError} from "../../lib/errors";
import {pickPermissionIds, withUpgradeHint, parseRepeatedFlag} from "./_shared";

type RolesCreateArgs = CommonOptions & {
  name?: string;
  description?: string;
  permission?: string | string[];
};

export default defineCommand({
  meta: {name: "create", description: "Create a new custom role for this business"},
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

    if (!name) {
      if (!interactive) throw new AtoaError("--name is required", "validation");
      const {input} = await import("@inquirer/prompts");
      name = (await input({message: "Role name"})).trim();
      if (!description) {
        description = (await input({message: "Description (optional)"})).trim() || undefined;
      }
    }
    if (!name) throw new AtoaError("role name is required", "validation");

    if (interactive && permissionIds.length === 0) {
      permissionIds = await pickPermissionIds(ctx);
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
      ctx.print(data);
    } catch (err) {
      throw withUpgradeHint(err);
    }
  })
});
