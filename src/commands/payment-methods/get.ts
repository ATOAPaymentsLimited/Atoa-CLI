import {defineCommand} from "citty";
import {withCommonArgs, runWithSdkKey, type CommonOptions} from "../_common";

type GetArgs = CommonOptions & {id?: string; customer?: string};

export default defineCommand({
  meta: {name: "get", description: "Get a payment method by ID"},
  args: withCommonArgs({
    id: {type: "positional", required: true, description: "card ID"},
    customer: {type: "string", required: true, description: "customer ID"}
  }),
  run: runWithSdkKey<GetArgs>(async (ctx, args) => {
    const path = `/api/customers/${encodeURIComponent(args.customer as string)}/cards/${encodeURIComponent(args.id as string)}`;

    if (ctx.dryRun) {
      ctx.print({method: "GET", path});
      return;
    }

    const {data} = await ctx.http.request({method: "GET", path});
    ctx.print(data);
  })
});
