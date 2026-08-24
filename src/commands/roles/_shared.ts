import {V1_ROUTES} from "../../lib/v1-routes";
import {AtoaError} from "../../lib/errors";
import {BackendErrorCode} from "../../lib/enums";
import type {CommandContext} from "../../lib/context";
import {t} from "../../lib/i18n";

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
  // Returning [] here would be read as "deselect everything" and strip the role's permissions,
  // so an empty catalogue fails loudly instead.
  if (categories.length === 0) {
    throw new AtoaError(t("permissionCatalogueUnavailable"), "generic");
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
 * Adds every prerequisite of the chosen permissions, following the chain to the end. What was
 * added is printed — silently granting a permission nobody asked for is worse than the gap.
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
 * Flag-supplied ids plus their prerequisites. Advisory only: the caller named what they want, so
 * a catalogue that fails to load lets the ids through and leaves the backend to decide.
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
    choices.push(new Separator(t("categorySeparator", {name: category.name ?? t("categoryOther")})));
    for (const perm of category.permissions ?? []) {
      if (!perm.id) continue;
      const requires = perm.dependsOnIds?.length ? t("permissionPullsInPrerequisites") : "";
      choices.push({
        name: t("permissionChoice", {name: perm.name ?? perm.id, requires}),
        value: perm.id,
        checked: preselected.includes(perm.id)
      });
    }
  }
  const selected = await checkbox<string>({message: t("selectPermissions"), pageSize: 15, choices});
  return announce(expandWithDependencies(selected.filter(Boolean), index));
}

function announce({ids, added}: {ids: string[]; added: string[]}): string[] {
  if (added.length > 0) {
    process.stderr.write(t("permissionsAlsoGranted", {permissions: added.join(", ")}));
  }
  return ids;
}

export interface RoleRow {
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
 * The raw record nests a full catalogue entry under every grant and every assigned user under
 * the role, so only permission names survive and the users become a count.
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

/** CUSTOM_ROLES addon-limit hit — adds the plan-limit hint to the backend's own message. */
export function withUpgradeHint(err: unknown): unknown {
  if (err instanceof AtoaError && err.errorCode === BackendErrorCode.ADDON_UPGRADE_REQUIRED) {
    return new AtoaError(t("customRolesUpgradeError", {message: err.message}), err.kind, {
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
