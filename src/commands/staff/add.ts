import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {fetchAllPages} from "../../lib/list-view";
import {isInteractive} from "../../lib/output";
import {AtoaError} from "../../lib/errors";
import {validateStaffName, isValidEmail, validateCountryCode, validatePhoneNumber} from "../../lib/validators";
import {DEFAULT_PHONE_COUNTRY_CODE, STORES_PAGE_SIZE} from "../../lib/constants";
import {t} from "../../lib/i18n";
import {projectStaff, parseRepeatedFlag} from "./_shared";
import type {CommandContext} from "../../lib/context";

type StaffAddArgs = CommonOptions & {
  firstName?: string;
  lastName?: string;
  email?: string;
  phoneCountryCode?: string;
  phone?: string;
  role?: string;
  store?: string | string[];
};

export default defineCommand({
  meta: {name: "add", description: "Add a staff member to this business (prompts for missing fields on a TTY)"},
  args: withCommonArgs({
    firstName: {type: "string", description: "first name"},
    lastName: {type: "string", description: "last name"},
    email: {type: "string", description: "email address"},
    phoneCountryCode: {type: "string", description: "phone country code, e.g. 44 (required with --phone)"},
    phone: {type: "string", description: "phone number without country code (required with --phone-country-code)"},
    role: {type: "string", description: "role ID (from `atoa roles list`)"},
    store: {type: "string", description: "permitted store ID (repeatable; omit for access to every store)"}
  }),
  run: runWithContext<StaffAddArgs>(async (ctx, args, rawArgs) => {
    const interactive = isInteractive(ctx.formatExplicit);

    let firstName = args.firstName?.trim();
    let lastName = args.lastName?.trim();
    let email = args.email?.trim();
    let phoneCountryCode = args.phoneCountryCode?.trim();
    let phoneNumber = args.phone?.trim();
    let roleId = args.role?.trim();
    let permittedStoreIds = parseRepeatedFlag(rawArgs, "--store");

    const hasContact = () => Boolean(email) || Boolean(phoneCountryCode && phoneNumber);

    if (!firstName || !lastName || !roleId || !hasContact()) {
      if (!interactive) {
        if (!firstName) throw new AtoaError(t("flagRequired", {flag: "first-name"}), "validation");
        if (!lastName) throw new AtoaError(t("flagRequired", {flag: "last-name"}), "validation");
        if (!roleId) throw new AtoaError(t("flagRequired", {flag: "role"}), "validation");
        if (!hasContact()) throw new AtoaError(t("contactFlagsRequired"), "validation");
      }

      const {input} = await import("@inquirer/prompts");
      if (!firstName) {
        firstName = (await input({message: t("labelFirstName"), validate: validateStaffName("first")})).trim();
      }
      if (!lastName) {
        lastName = (await input({message: t("labelLastName"), validate: validateStaffName("last")})).trim();
      }
      if (!hasContact()) {
        const contact = await promptForContact(phoneCountryCode, phoneNumber);
        email = contact.email ?? email;
        phoneCountryCode = contact.phoneCountryCode ?? phoneCountryCode;
        phoneNumber = contact.phoneNumber ?? phoneNumber;
      }
      if (!roleId) roleId = await pickRoleId(ctx);
    }

    // Store selection is independent of the block above — always offer it on a
    // TTY when no --store flags were passed, even if every other field arrived via flag.
    if (interactive && permittedStoreIds.length === 0) {
      permittedStoreIds = await pickStoreIds(ctx);
    }

    // A phone with no country code defaults to the UK rather than failing — the same
    // assumption the prompt above makes, applied to the flag path.
    if (phoneNumber && !phoneCountryCode) phoneCountryCode = DEFAULT_PHONE_COUNTRY_CODE;

    if (!roleId) throw new AtoaError(t("roleRequired"), "validation");
    if (!hasContact()) throw new AtoaError(t("contactRequired"), "validation");

    assertStaffFields({firstName, lastName, email, phoneCountryCode, phoneNumber});

    const body: Record<string, unknown> = {firstName, lastName, roleId};
    if (email) body["email"] = email;
    if (phoneNumber) body["phoneNumber"] = phoneNumber;
    if (phoneCountryCode) body["phoneCountryCode"] = phoneCountryCode;
    if (permittedStoreIds.length > 0) body["permittedStoreIds"] = permittedStoreIds;

    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.staff.create, body});
      return;
    }
    const {data} = await ctx.http.request({...V1_ROUTES.staff.create, body});
    ctx.print(projectStaff((data ?? {}) as never));
  })
});

function assertValid(result: true | string): void {
  if (typeof result === "string") throw new AtoaError(result, "validation");
}

/** Re-checks every field so flag-supplied values face the same rules as typed ones. */
function assertStaffFields(f: {
  firstName?: string;
  lastName?: string;
  email?: string;
  phoneCountryCode?: string;
  phoneNumber?: string;
}): void {
  assertValid(validateStaffName("first")(f.firstName ?? ""));
  assertValid(validateStaffName("last")(f.lastName ?? ""));
  if (f.email) assertValid(isValidEmail(f.email) || t("emailError"));
  if (f.phoneCountryCode) assertValid(validateCountryCode(f.phoneCountryCode));
  if (f.phoneNumber) assertValid(validatePhoneNumber(f.phoneNumber));
}

/**
 * The backend needs an email or a full phone, not both — so this asks for an email first and
 * only falls through to the phone pair when it's left blank.
 */
async function promptForContact(
  existingCountryCode: string | undefined,
  existingNumber: string | undefined
): Promise<{email?: string; phoneCountryCode?: string; phoneNumber?: string}> {
  const {input} = await import("@inquirer/prompts");

  const email = (
    await input({
      message: `${t("labelEmailAddress")} (leave blank to use a phone number instead)`,
      validate: (v) => !v.trim() || isValidEmail(v.trim()) || t("emailError")
    })
  ).trim();
  if (email) return {email};

  const phoneCountryCode =
    existingCountryCode ||
    (
      await input({
        message: t("labelPhoneCountryCode"),
        default: DEFAULT_PHONE_COUNTRY_CODE,
        validate: validateCountryCode
      })
    ).trim();
  const phoneNumber =
    existingNumber || (await input({message: t("labelPhoneNumber"), validate: validatePhoneNumber})).trim();

  return {phoneCountryCode, phoneNumber};
}

async function pickRoleId(ctx: CommandContext): Promise<string> {
  const rows = (await fetchAllPages(ctx, V1_ROUTES.roles.list)) as Array<{id?: string; name?: string}>;
  if (rows.length === 0) throw new AtoaError(t("noRolesFound"), "not_found");

  const {select} = await import("@inquirer/prompts");
  const roleId = await select<string>({
    message: t("selectRole"),
    pageSize: 12,
    choices: rows.map((r) => ({name: r.name ?? t("unnamedRole"), value: r.id ?? ""}))
  });
  if (!roleId) throw new AtoaError(t("noRoleSelected"), "validation");
  return roleId;
}

async function pickStoreIds(ctx: CommandContext): Promise<string[]> {
  const rows = (await fetchAllPages(ctx, V1_ROUTES.stores.list, {}, STORES_PAGE_SIZE)) as Array<{
    id?: string;
    locationName?: string;
  }>;
  if (rows.length === 0) return [];

  const {checkbox} = await import("@inquirer/prompts");
  const storeIds = await checkbox<string>({
    message: t("permittedStoresPrompt"),
    pageSize: 12,
    choices: rows.map((s) => ({name: s.locationName ?? t("unnamedStore"), value: s.id ?? ""}))
  });
  return storeIds.filter(Boolean);
}
