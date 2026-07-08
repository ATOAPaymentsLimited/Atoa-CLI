import {defineCommand} from "citty";
import {withCommonArgs, runWithSdkKey, type CommonOptions} from "../_common";

type ListArgs = CommonOptions & {customer?: string};

export default defineCommand({
  meta: {name: "list", description: "List payment methods for a customer"},
  args: withCommonArgs({
    customer: {type: "string", required: true, description: "customer ID"}
  }),
  run: runWithSdkKey<ListArgs>(async (ctx, args) => {
    const path = `/api/customers/${encodeURIComponent(args.customer as string)}/cards`;

    if (ctx.dryRun) {
      ctx.print({method: "GET", path});
      return;
    }

    const {data} = await ctx.http.request({method: "GET", path});
    ctx.print(data);
  })
});
