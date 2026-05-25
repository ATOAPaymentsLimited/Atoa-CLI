import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";

type GetArgs = CommonOptions & {id?: string};

export default defineCommand({
  meta: {name: "get", description: "Get a customer by ID"},
  args: withCommonArgs({
    id: {type: "positional", required: true, description: "customer ID"}
  }),
  run: runWithContext<GetArgs>(async (ctx, args) => {
    const path = `/api/customers/${encodeURIComponent(args.id as string)}`;

    if (ctx.dryRun) {
      ctx.print({method: "GET", path});
      return;
    }

    const {data} = await ctx.http.request({method: "GET", path});
    ctx.print(data);
  })
});
