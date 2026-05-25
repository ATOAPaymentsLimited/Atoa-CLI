import {defineCommand} from "citty";
import {withCommonArgs, runWithContext} from "./_common";

interface CliIdentity {
  merchantId: string;
  businessName: string;
}

export default defineCommand({
  meta: {name: "whoami", description: "Validate credentials and display current identity"},
  args: withCommonArgs({}),
  run: runWithContext(async (ctx) => {
    const identity = (await ctx.http.request({method: "GET", path: "/api/cli/identity"})).data as CliIdentity;

    ctx.print({
      profile: ctx.profileName,
      env: ctx.env,
      tokenFingerprint: `…${ctx.authFingerprint}`,
      businessName: identity.businessName,
      hint: "use 'atoa profile list' to see all profiles"
    });
  })
});
