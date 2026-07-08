import {defineCommand} from "citty";
import {withCommonArgs, runWithSdkKey, type CommonOptions} from "../_common";

type InitiateArgs = CommonOptions & {
  redirectUrl?: string;
  callbackParams?: string;
};

export default defineCommand({
  meta: {name: "initiate", description: "Start a bank-feed authorization flow"},
  args: withCommonArgs({
    redirectUrl: {type: "string", required: true, description: "redirect URL after user consent"},
    callbackParams: {
      type: "string",
      description:
        "custom data appended to the redirect URL as a query param, useful for tracking your own session or order ID through the bank-feed flow"
    }
  }),
  run: runWithSdkKey<InitiateArgs>(async (ctx, args) => {
    const body = {
      redirectUrl: args.redirectUrl as string,
      ...(args.callbackParams && {callbackParams: args.callbackParams})
    };

    if (ctx.dryRun) {
      ctx.print({method: "POST", path: "/api/bank/auth/initiate", body});
      return;
    }

    const {data} = await ctx.http.request({
      method: "POST",
      path: "/api/bank/auth/initiate",
      body
    });
    ctx.print(data);
  })
});
