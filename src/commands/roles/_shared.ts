import {V1_ROUTES} from "../../lib/v1-routes";
import {AtoaError} from "../../lib/errors";
import type {CommandContext} from "../../lib/context";

interface PermissionCategoryRow {
  name?: string;
  permissions?: Array<{id?: string; name?: string}>;
}

/** Interactive multi-select over the permission catalogue, grouped by category. */
export async function pickPermissionIds(ctx: CommandContext, preselected: string[] = []): Promise<string[]> {
  const {data} = await ctx.http.request({...V1_ROUTES.permissions.list});
  const categories = ((data as {availablePermissions?: PermissionCategoryRow[]})?.availablePermissions ??
    []) as PermissionCategoryRow[];
  // An empty catalogue is indistinguishable from "the user deselected everything" once we
  // return []. Callers set permissionsTouched on the result, so returning [] here would send
  // permissionIds: [] and strip every permission from the role. Fail loudly instead.
  if (categories.length === 0) {
    throw new AtoaError(
      "Could not load the permission catalogue, so permissions were left unchanged. Retry, or pass --permission explicitly.",
      "generic"
    );
  }

  const {checkbox, Separator} = await import("@inquirer/prompts");
  const choices: Array<InstanceType<typeof Separator> | {name: string; value: string; checked?: boolean}> = [];
  for (const category of categories) {
    choices.push(new Separator(`— ${category.name ?? "Other"} —`));
    for (const perm of category.permissions ?? []) {
      if (!perm.id) continue;
      choices.push({name: perm.name ?? perm.id, value: perm.id, checked: preselected.includes(perm.id)});
    }
  }
  const selected = await checkbox<string>({message: "Select permissions", pageSize: 15, choices});
  return selected.filter(Boolean);
}

/** CUSTOM_ROLES addon-limit hit: the backend rejects with errorCode ADDON_UPGRADE_REQUIRED. */
export function withUpgradeHint(err: unknown): unknown {
  if (err instanceof AtoaError && err.errorCode === "ADDON_UPGRADE_REQUIRED") {
    return new AtoaError(`${err.message} — run 'atoa addons list' to see plan limits (custom roles)`, err.kind, {
      status: err.status,
      errorCode: err.errorCode,
      requestId: err.requestId,
      additionalData: err.additionalData
    });
  }
  return err;
}

/** Extracts all values for a repeated flag (`--permission x --permission y` or `--permission=x`). */
export function parseRepeatedFlag(rawArgs: string[], flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (a === flag && i + 1 < rawArgs.length) {
      out.push(rawArgs[i + 1]);
    } else if (a.startsWith(`${flag}=`)) {
      out.push(a.slice(flag.length + 1));
    }
  }
  return out;
}
