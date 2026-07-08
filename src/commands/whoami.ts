import {defineCommand} from "citty";
import {withCommonArgs, runWithContext} from "./_common";
import {V1_ROUTES} from "../lib/v1-routes";
import {isInteractive, renderKeyValues} from "../lib/output";

interface V1Identity {
  userId: string;
  businessId: string;
  source: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phoneCountryCode?: string;
  phoneNumber?: string;
}

export default defineCommand({
  meta: {name: "whoami", description: "Validate credentials and display current identity"},
  args: withCommonArgs({}),
  run: runWithContext(async (ctx) => {
    const identity = (await ctx.http.request({...V1_ROUTES.identity.get})).data as V1Identity;
    const name = [identity.firstName, identity.lastName].filter(Boolean).join(" ") || undefined;
    const phone = identity.phoneNumber
      ? [identity.phoneCountryCode && `+${identity.phoneCountryCode}`, identity.phoneNumber].filter(Boolean).join(" ")
      : undefined;

    // undefined fields are dropped by JSON output, so the result stays clean when a
    // user hasn't set a name/email/phone yet.
    const data = {
      profile: ctx.profileName,
      business: ctx.profile.displayName,
      name,
      email: identity.email,
      phone
    };

    // Scripting (piped, or explicit --output) keeps the machine-readable object;
    // an interactive terminal gets a labelled, aligned summary.
    if (!isInteractive(ctx.formatExplicit)) {
      ctx.print(data);
      return;
    }

    const heading = name ?? data.business ?? identity.email ?? ctx.profileName;
    const rows: Array<[string, string | undefined]> = [
      ["Business", data.business === heading ? undefined : data.business],
      ["Email", identity.email],
      ["Phone", phone],
      ["Profile", ctx.profileName]
    ];
    process.stdout.write(renderKeyValues(`Signed in as ${heading}`, rows) + "\n");
  })
});
