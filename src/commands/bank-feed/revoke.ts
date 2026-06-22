import {defineCommand} from "citty";
import {confirm} from "@inquirer/prompts";
import {withCommonArgs, runWithSdkKey, type CommonOptions} from "../_common";

type RevokeArgs = CommonOptions & {accountAuthId?: string};

export default defineCommand({
  meta: {name: "revoke", description: "Revoke bank-feed authorization"},
  args: withCommonArgs({
    accountAuthId: {
      type: "string",
      description:
        "accountAuthId to revoke a single consent. Leave unset to revoke every bank-feed consent for this merchant."
    }
  }),
  run: runWithSdkKey<RevokeArgs>(async (ctx, args) => {
    const path = "/api/bank/auth/revoke";
    const body = args.accountAuthId ? {accountAuthId: args.accountAuthId} : undefined;
    const message = args.accountAuthId
      ? `Revoke bank feed access for accountAuthId ${args.accountAuthId}?`
      : "Revoke ALL bank feed access for this merchant (no --accountAuthId given)?";

    if (ctx.dryRun) {
      ctx.print({method: "POST", path, body});
      return;
    }

    if (!ctx.yes) {
      const ok = await confirm({message});
      if (!ok) {
        process.stdout.write("Aborted.\n");
        return;
      }
    }

    const {data} = await ctx.http.request({method: "POST", path, body});
    ctx.print(data);
  })
});
