import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {fetchAllPages} from "../../lib/list-view";
import {isInteractive} from "../../lib/output";
import {AtoaError} from "../../lib/errors";
import {resolveField} from "../../lib/prompt-field";
import {validateStaffName, isValidEmail, validateCountryCode, validatePhoneNumber} from "../../lib/validators";
import {DEFAULT_PHONE_COUNTRY_CODE, STORES_PAGE_SIZE} from "../../lib/constants";
import {t} from "../../lib/i18n";
import {projectStaff, parseRepeatedFlag} from "./_shared";
import type {CommandContext} from "../../lib/context";

type StaffUpdateArgs = CommonOptions & {
  userId?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phoneCountryCode?: string;
  phone?: string;
  role?: string;
  store?: string | string[];
};

interface StaffRow {
  id?: string;
  user?: {
    id?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    phoneCountryCode?: string;
    phoneNumber?: string;
  };
  role?: {id?: string; name?: string};
  permittedStores?: Array<{store?: {id?: string; locationName?: string}}>;
}

const sameSet = (a: string[], b: string[]): boolean => {
  const x = [...a].sort();
  const y = [...b].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

interface NextStaff {
  firstName?: string;
  lastName?: string;
  email?: string;
  phoneCountryCode: string;
  phoneNumber?: string;
  roleId: string;
  storeIds: string[];
}

/** True when any editable field differs — an update that changes nothing is a wasted write. */
function hasChanges(next: NextStaff, current: CurrentStaff): boolean {
  return (
    (next.firstName ?? "") !== current.firstName ||
    (next.lastName ?? "") !== current.lastName ||
    (next.email ?? "") !== current.email ||
    (next.phoneNumber ?? "") !== current.phoneNumber ||
    next.phoneCountryCode !== current.phoneCountryCode ||
    next.roleId !== current.roleId ||
    !sameSet(next.storeIds, current.storeIds)
  );
}

export default defineCommand({
  meta: {name: "update", description: "Update a staff member's details, role and permitted stores"},
  args: withCommonArgs({
    userId: {
      type: "positional",
      required: false,
      description: "user ID of the staff member (omit to pick from the staff list on a TTY)"
    },
    firstName: {type: "string", description: "first name"},
    lastName: {type: "string", description: "last name"},
    email: {type: "string", description: "email address"},
    phoneCountryCode: {type: "string", description: "phone country code, e.g. 44 (required with --phone)"},
    phone: {type: "string", description: "phone number without country code"},
    role: {type: "string", description: "role ID (from `atoa roles list`)"},
    store: {type: "string", description: "permitted store ID (repeatable; replaces the current set)"}
  }),
  run: runWithContext<StaffUpdateArgs>(async (ctx, args, rawArgs) => {
    const interactive = isInteractive(ctx.formatExplicit);
    const rows = (await fetchAllPages(ctx, V1_ROUTES.staff.list)) as StaffRow[];

    let userId = args.userId?.trim();
    if (!userId) {
      if (!interactive) throw new AtoaError(t("argRequiredNonInteractive", {arg: "userId"}), "validation");
      userId = await pickStaffUserId(rows);
    }

    const existing = rows.find((r) => r.user?.id === userId);
    if (!existing) throw new AtoaError(`no staff member found with user id ${userId}`, "not_found");

    const current = {
      firstName: existing.user?.firstName ?? "",
      lastName: existing.user?.lastName ?? "",
      email: existing.user?.email ?? "",
      phoneCountryCode: existing.user?.phoneCountryCode ?? "",
      phoneNumber: existing.user?.phoneNumber ?? "",
      roleId: existing.role?.id ?? "",
      storeIds: (existing.permittedStores ?? []).map((p) => p.store?.id).filter((id): id is string => Boolean(id))
    };

    const {firstName, lastName, email, phoneNumber} = await collectFields(args, current, interactive);

    let phoneCountryCode = args.phoneCountryCode?.trim() || current.phoneCountryCode;
    if (phoneNumber && !phoneCountryCode) phoneCountryCode = DEFAULT_PHONE_COUNTRY_CODE;
    if (phoneCountryCode) {
      const verdict = validateCountryCode(phoneCountryCode);
      if (verdict !== true) throw new AtoaError(verdict, "validation");
    }

    // The backend rejects an update that would leave a staff member with no way to be reached.
    if (!email && !(phoneCountryCode && phoneNumber)) {
      throw new AtoaError(t("contactRequired"), "validation");
    }

    const roleId = args.role?.trim() || (interactive ? await pickRoleId(ctx, current.roleId) : current.roleId);

    let storeIds = parseRepeatedFlag(rawArgs, "--store");
    const storesTouched = storeIds.length > 0;
    if (!storesTouched && interactive) {
      storeIds = await pickStoreIds(ctx, current.storeIds);
    } else if (!storesTouched) {
      storeIds = current.storeIds;
    }

    const next = {firstName, lastName, email, phoneCountryCode, phoneNumber, roleId, storeIds};
    if (!hasChanges(next, current)) {
      ctx.print({status: t("noChanges"), staff: [firstName, lastName].filter(Boolean).join(" ")});
      return;
    }

    // firstName/lastName/roleId are always sent: the backend treats this as a full replacement
    // of the record, so omitting an unchanged field would blank it.
    const body: Record<string, unknown> = {firstName, lastName, roleId, permittedStoreIds: storeIds};
    if (email) body.email = email;
    if (phoneNumber) {
      body.phoneNumber = phoneNumber.replace(/^0+/, "");
      body.phoneCountryCode = phoneCountryCode;
    }

    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.staff.update, pathParams: {userId}, body});
      return;
    }

    const {data} = await ctx.http.request({...V1_ROUTES.staff.update, pathParams: {userId}, body});
    ctx.print(projectStaff((data ?? {}) as never));
  })
});

interface CurrentStaff {
  firstName: string;
  lastName: string;
  email: string;
  phoneCountryCode: string;
  phoneNumber: string;
  roleId: string;
  storeIds: string[];
}

/**
 * Collects the editable text fields.
 *
 * Each is offered with its current value filled in, so the record can be edited in place —
 * Enter keeps a value, typing replaces it. Off a TTY an omitted flag keeps the current value:
 * an update must not blank fields the caller never mentioned.
 */
async function collectFields(
  args: StaffUpdateArgs,
  current: CurrentStaff,
  interactive: boolean
): Promise<{firstName?: string; lastName?: string; email?: string; phoneNumber?: string}> {
  const keep = (flagValue: string | undefined, currentValue: string) =>
    interactive ? flagValue : (flagValue ?? currentValue);

  return {
    firstName: await resolveField({
      value: keep(args.firstName, current.firstName),
      flag: "first-name",
      message: t("labelFirstName"),
      rule: validateStaffName("first"),
      interactive,
      default: current.firstName
    }),
    lastName: await resolveField({
      value: keep(args.lastName, current.lastName),
      flag: "last-name",
      message: t("labelLastName"),
      rule: validateStaffName("last"),
      interactive,
      default: current.lastName
    }),
    email: await resolveField({
      value: keep(args.email, current.email),
      flag: "email",
      message: t("labelEmailAddress"),
      rule: (v) => !v.trim() || isValidEmail(v.trim()) || t("emailError"),
      interactive,
      optional: true,
      default: current.email
    }),
    phoneNumber: await resolveField({
      value: keep(args.phone, current.phoneNumber),
      flag: "phone",
      message: t("labelPhoneNumber"),
      rule: validatePhoneNumber,
      interactive,
      optional: true,
      default: current.phoneNumber
    })
  };
}

async function pickStaffUserId(rows: StaffRow[]): Promise<string> {
  if (rows.length === 0) throw new AtoaError(t("noStaffFound"), "not_found");

  const {select} = await import("@inquirer/prompts");
  const userId = await select<string>({
    message: t("selectStaffToUpdate"),
    pageSize: 12,
    choices: rows.map((s) => {
      const name = [s.user?.firstName, s.user?.lastName].filter(Boolean).join(" ");
      return {
        name: [name || s.user?.email, s.role?.name].filter(Boolean).join("  ·  "),
        value: s.user?.id ?? ""
      };
    })
  });
  if (!userId) throw new AtoaError(t("noStaffSelected"), "validation");
  return userId;
}

async function pickRoleId(ctx: CommandContext, currentRoleId: string): Promise<string> {
  const roles = (await fetchAllPages(ctx, V1_ROUTES.roles.list)) as Array<{id?: string; name?: string}>;
  if (roles.length === 0) return currentRoleId;

  const {select} = await import("@inquirer/prompts");
  return await select<string>({
    message: t("labelRole"),
    pageSize: 12,
    default: currentRoleId || undefined,
    choices: roles.map((r) => ({name: r.name ?? t("unnamedRole"), value: r.id ?? ""}))
  });
}

/** Store multi-select, pre-ticked with the stores the member already has. */
async function pickStoreIds(ctx: CommandContext, currentStoreIds: string[]): Promise<string[]> {
  const stores = (await fetchAllPages(ctx, V1_ROUTES.stores.list, {}, STORES_PAGE_SIZE)) as Array<{
    id?: string;
    locationName?: string;
  }>;
  if (stores.length === 0) return currentStoreIds;

  const {checkbox} = await import("@inquirer/prompts");
  const picked = await checkbox<string>({
    message: t("permittedStoresPrompt"),
    pageSize: 12,
    choices: stores.map((s) => ({
      name: s.locationName ?? t("unnamedStore"),
      value: s.id ?? "",
      checked: currentStoreIds.includes(s.id ?? "")
    }))
  });
  return picked.filter(Boolean);
}
