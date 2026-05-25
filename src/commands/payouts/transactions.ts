import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {walkAllPages} from "../../lib/pagination";

type TxArgs = CommonOptions & {
  id?: string;
  page?: string;
  limit?: string;
  pageAll?: boolean;
};

export default defineCommand({
  meta: {name: "transactions", description: "List transactions for a payout"},
  args: withCommonArgs({
    id: {type: "positional", required: true, description: "payoutId"},
    page: {type: "string", default: "0", description: "page number (0-indexed)"},
    limit: {type: "string", default: "20", description: "page size"},
    pageAll: {type: "boolean", description: "auto-walk all pages"}
  }),
  run: runWithContext<TxArgs>(async (ctx, args) => {
    const path = `/api/payouts/${encodeURIComponent(args.id as string)}/transactions`;

    if (ctx.dryRun) {
      ctx.print({method: "GET", path, query: {page: args.page, limit: args.limit}});
      return;
    }

    if (args.pageAll) {
      const limit = Number(args.limit);
      const all = await walkAllPages({
        pageSize: limit,
        fetchPage: async (page) => {
          const {data} = await ctx.http.request({
            method: "GET",
            path,
            query: {page, limit}
          });
          return data;
        }
      });
      ctx.print(all);
    } else {
      const {data} = await ctx.http.request({
        method: "GET",
        path,
        query: {page: args.page, limit: args.limit}
      });
      ctx.print(data);
    }
  })
});
