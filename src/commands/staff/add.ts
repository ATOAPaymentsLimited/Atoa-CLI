import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {fetchAllPages} from "../../lib/list-view";
import {isInteractive} from "../../lib/output";
import {AtoaError} from "../../lib/errors";
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
        if (!firstName) throw new AtoaError("--first-name is required", "validation");
        if (!lastName) throw new AtoaError("--last-name is required", "validation");
        if (!roleId) throw new AtoaError("--role is required", "validation");
        if (!hasContact())
          throw new AtoaError("provide --email, or both --phone-country-code and --phone", "validation");
      }

      const {input} = await import("@inquirer/prompts");
      if (!firstName) firstName = (await input({message: "First name"})).trim();
      if (!lastName) lastName = (await input({message: "Last name"})).trim();
      if (!hasContact()) {
        const emailAnswer = (await input({message: "Email (leave blank to use a phone number instead)"})).trim();
        if (emailAnswer) {
          email = emailAnswer;
        } else {
          phoneCountryCode = phoneCountryCode || (await input({message: "Phone country code, e.g. 44"})).trim();
          phoneNumber = phoneNumber || (await input({message: "Phone number"})).trim();
        }
      }
      if (!roleId) roleId = await pickRoleId(ctx);
    }

    // Store selection is independent of the block above — always offer it on a
    // TTY when no --store flags were passed, even if every other field arrived via flag.
    if (interactive && permittedStoreIds.length === 0) {
      permittedStoreIds = await pickStoreIds(ctx);
    }

    if (!firstName) throw new AtoaError("first name is required", "validation");
    if (!lastName) throw new AtoaError("last name is required", "validation");
    if (!roleId) throw new AtoaError("role is required", "validation");
    if (!hasContact())
      throw new AtoaError("provide an email, or both a phone country code and phone number", "validation");

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

    const member = (data ?? {}) as {
      id?: string;
      userType?: string;
      user?: {id?: string; firstName?: string; lastName?: string; email?: string};
      role?: {id?: string; name?: string};
    };
    ctx.print({id: member.id, userType: member.userType, user: member.user, role: member.role});
  })
});

async function pickRoleId(ctx: CommandContext): Promise<string> {
  const rows = (await fetchAllPages(ctx, V1_ROUTES.roles.list)) as Array<{id?: string; name?: string}>;
  if (rows.length === 0) throw new AtoaError("no roles found for this business", "not_found");

  const {select} = await import("@inquirer/prompts");
  const roleId = await select<string>({
    message: "Select a role",
    pageSize: 12,
    choices: rows.map((r) => ({name: r.name ?? "(unnamed role)", value: r.id ?? ""}))
  });
  if (!roleId) throw new AtoaError("no role selected", "validation");
  return roleId;
}

async function pickStoreIds(ctx: CommandContext): Promise<string[]> {
  const rows = (await fetchAllPages(ctx, V1_ROUTES.stores.list)) as Array<{id?: string; locationName?: string}>;
  if (rows.length === 0) return [];

  const {checkbox} = await import("@inquirer/prompts");
  const storeIds = await checkbox<string>({
    message: "Permitted stores (leave empty for access to every store)",
    pageSize: 12,
    choices: rows.map((s) => ({name: s.locationName ?? "(unnamed store)", value: s.id ?? ""}))
  });
  return storeIds.filter(Boolean);
}

/**
 * Extracts all values for a repeated flag from raw CLI args.
 * Handles both `--store id` and `--store=id` forms.
 */
function parseRepeatedFlag(rawArgs: string[], flag: string): string[] {
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
