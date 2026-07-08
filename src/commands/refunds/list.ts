import {defineCommand} from "citty";
import {withCommonArgs, runWithSdkKey, type CommonOptions} from "../_common";

type ListArgs = CommonOptions & {paymentRequestId?: string};

export default defineCommand({
  meta: {name: "list", description: "List refunds for a payment request"},
  args: withCommonArgs({
    paymentRequestId: {type: "string", required: true, description: "paymentRequestId"}
  }),
  run: runWithSdkKey<ListArgs>(async (ctx, args) => {
    const path = `/api/refund/${encodeURIComponent(args.paymentRequestId as string)}`;

    if (ctx.dryRun) {
      ctx.print({method: "GET", path});
      return;
    }

    const {data} = await ctx.http.request({method: "GET", path});
    ctx.print(data);
  })
});
