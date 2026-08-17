import {V1_ROUTES} from "../../lib/v1-routes";
import {AtoaError} from "../../lib/errors";
import type {CommandContext} from "../../lib/context";

interface PermissionRow {
  id?: string;
  name?: string;
  /** Permissions this one cannot work without — e.g. refunding requires viewing payments. */
  dependsOnIds?: string[];
}

interface PermissionCategoryRow {
  name?: string;
  permissions?: PermissionRow[];
}

export type PermissionIndex = Map<string, {name: string; dependsOnIds: string[]}>;

async function fetchCategories(ctx: CommandContext): Promise<PermissionCategoryRow[]> {
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
  return categories;
}

function indexPermissions(categories: PermissionCategoryRow[]): PermissionIndex {
  const index: PermissionIndex = new Map();
  for (const category of categories) {
    for (const perm of category.permissions ?? []) {
      if (perm.id) index.set(perm.id, {name: perm.name ?? perm.id, dependsOnIds: perm.dependsOnIds ?? []});
    }
  }
  return index;
}

/**
 * Adds every permission the chosen ones depend on, following the chain to the end.
 *
 * A role that grants "refund a payment" without "view payments" is broken, so the picker
 * ticks the prerequisites for you as you select. A terminal checkbox has no per-toggle hook,
 * so the same closure is applied once the selection is made — and what it added is printed,
 * because silently granting a permission nobody asked for is worse than the gap it fixes.
 */
export function expandWithDependencies(ids: string[], index: PermissionIndex): {ids: string[]; added: string[]} {
  const chosen = new Set(ids);
  const added: string[] = [];
  const queue = [...ids];

  while (queue.length > 0) {
    const id = queue.pop() as string;
    for (const dep of index.get(id)?.dependsOnIds ?? []) {
      if (chosen.has(dep)) continue;
      chosen.add(dep);
      queue.push(dep);
      added.push(index.get(dep)?.name ?? dep);
    }
  }
  return {ids: [...chosen], added};
}

/**
 * Resolves flag-supplied permission ids, pulling in their prerequisites.
 *
 * Expansion is advisory: the caller named the permissions they want, so a catalogue that fails
 * to load must not sink the request. The ids go through unchanged and the backend — which
 * enforces the same dependencies — has the final say.
 */
export async function resolvePermissionIds(ctx: CommandContext, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return ids;
  try {
    const index = indexPermissions(await fetchCategories(ctx));
    return announce(expandWithDependencies(ids, index));
  } catch {
    return ids;
  }
}

/** Interactive multi-select over the permission catalogue, grouped by category. */
export async function pickPermissionIds(ctx: CommandContext, preselected: string[] = []): Promise<string[]> {
  const categories = await fetchCategories(ctx);
  const index = indexPermissions(categories);

  const {checkbox, Separator} = await import("@inquirer/prompts");
  const choices: Array<InstanceType<typeof Separator> | {name: string; value: string; checked?: boolean}> = [];
  for (const category of categories) {
    choices.push(new Separator(`— ${category.name ?? "Other"} —`));
    for (const perm of category.permissions ?? []) {
      if (!perm.id) continue;
      const requires = perm.dependsOnIds?.length ? "  (pulls in its prerequisites)" : "";
      choices.push({
        name: `${perm.name ?? perm.id}${requires}`,
        value: perm.id,
        checked: preselected.includes(perm.id)
      });
    }
  }
  const selected = await checkbox<string>({message: "Select permissions", pageSize: 15, choices});
  return announce(expandWithDependencies(selected.filter(Boolean), index));
}

function announce({ids, added}: {ids: string[]; added: string[]}): string[] {
  if (added.length > 0) {
    process.stderr.write(`Also granted, required by your selection: ${added.join(", ")}\n`);
  }
  return ids;
}

interface RoleRow {
  id?: string;
  name?: string;
  description?: string;
  isActive?: boolean;
  roleScopeType?: string;
  createdAt?: string;
  updatedAt?: string;
  rolePermissions?: Array<{permission?: {name?: string}}>;
  userWithRoles?: unknown[];
}

/**
 * Trims a role down to what is readable in a terminal. The raw record nests the whole
 * permission catalogue entry under every grant, and every assigned user under the role — so
 * only the permission names survive, and the users become a count.
 */
export function projectRole(row: RoleRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    roleScopeType: row.roleScopeType,
    isActive: row.isActive,
    permissions: (row.rolePermissions ?? []).map((rp) => rp.permission?.name).filter(Boolean),
    assignedUsers: row.userWithRoles?.length ?? 0
  };
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
