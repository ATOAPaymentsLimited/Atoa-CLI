import {defineCommand} from "citty";
import {withCommonArgs, runWithSdkKey, type CommonOptions} from "../_common";

type BalanceArgs = CommonOptions & {id?: string};

export default defineCommand({
  meta: {name: "balance", description: "Get bank account balance"},
  args: withCommonArgs({
    id: {type: "positional", required: true, description: "accountId"}
  }),
  run: runWithSdkKey<BalanceArgs>(async (ctx, args) => {
    const path = `/api/bank/accounts/${encodeURIComponent(args.id as string)}/balance`;

    if (ctx.dryRun) {
      ctx.print({method: "GET", path});
      return;
    }

    const {data} = await ctx.http.request({method: "GET", path});
    ctx.print(data);
  })
});
