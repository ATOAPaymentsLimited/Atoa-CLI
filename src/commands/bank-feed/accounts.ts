import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";

type AccountsArgs = CommonOptions & {accountAuthId?: string};

export default defineCommand({
  meta: {name: "accounts", description: "List all bank accounts for an authorized consent"},
  args: withCommonArgs({
    accountAuthId: {type: "positional", required: true, description: "accountAuthId returned by initiate"}
  }),
  run: runWithContext<AccountsArgs>(async (ctx, args) => {
    const path = `/api/bank/${encodeURIComponent(args.accountAuthId as string)}/accounts`;

    if (ctx.dryRun) {
      ctx.print({method: "GET", path});
      return;
    }

    const {data} = await ctx.http.request({method: "GET", path});
    ctx.print(data);
  })
});
