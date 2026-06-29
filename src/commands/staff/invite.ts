import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {AtoaError} from "../../lib/errors";

type StaffInviteArgs = CommonOptions & {
  firstName: string;
  lastName: string;
  email?: string;
  phoneCountryCode?: string;
  phone?: string;
  role: string;
  store?: string | string[];
};

export default defineCommand({
  meta: {name: "invite", description: "Invite a new staff member to this business"},
  args: withCommonArgs({
    firstName: {type: "string", required: true, description: "first name"},
    lastName: {type: "string", required: true, description: "last name"},
    email: {type: "string", description: "email address"},
    phoneCountryCode: {type: "string", description: "phone country code, e.g. 44 (required with --phone)"},
    phone: {type: "string", description: "phone number without country code (required with --phone-country-code)"},
    role: {type: "string", required: true, description: "role ID (from `atoa roles list`)"},
    store: {type: "string", description: "permitted store ID (repeatable)"}
  }),
  run: runWithContext<StaffInviteArgs>(async (ctx, args, rawArgs) => {
    const firstName = args.firstName?.trim();
    const lastName = args.lastName?.trim();
    const roleId = args.role?.trim();

    if (!firstName) throw new AtoaError("--first-name is required", "validation");
    if (!lastName) throw new AtoaError("--last-name is required", "validation");
    if (!roleId) throw new AtoaError("--role is required", "validation");

    // Collect all --store values (citty flattens repeated flags to last value;
    // we parse rawArgs to capture all occurrences).
    const permittedStoreIds = parseRepeatedFlag(rawArgs, "--store");

    const email = args.email?.trim();
    const phoneNumber = args.phone?.trim();
    const phoneCountryCode = args.phoneCountryCode?.trim();

    // Backend requires at least one of email or a full phone (country code +
    // number); a bare number is rejected. Fail fast.
    if (!email && !(phoneCountryCode && phoneNumber)) {
      throw new AtoaError("provide --email, or both --phone-country-code and --phone", "validation");
    }

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

    // Response is a BusinessToUser. Surface the new membership id, the assigned
    // role and user type, plus the user's name/contact, all read defensively.
    const member = (data ?? {}) as {
      id?: string;
      userType?: string;
      user?: {id?: string; firstName?: string; lastName?: string; email?: string};
      role?: {id?: string; name?: string};
    };
    ctx.print({
      id: member.id,
      userType: member.userType,
      user: member.user,
      role: member.role
    });
  })
});

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
