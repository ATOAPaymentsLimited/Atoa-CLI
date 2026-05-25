import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";

type AccountArgs = CommonOptions & {id?: string};

export default defineCommand({
  meta: {name: "account", description: "Get bank account details"},
  args: withCommonArgs({
    id: {type: "positional", required: true, description: "accountId"}
  }),
  run: runWithContext<AccountArgs>(async (ctx, args) => {
    const path = `/api/bank/accounts/${encodeURIComponent(args.id as string)}`;

    if (ctx.dryRun) {
      ctx.print({method: "GET", path});
      return;
    }

    const {data} = await ctx.http.request({method: "GET", path});
    ctx.print(data);
  })
});
