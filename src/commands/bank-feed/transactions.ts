import {defineCommand} from "citty";
import {withCommonArgs, runWithSdkKey, type CommonOptions} from "../_common";
import {walkAllPages} from "../../lib/pagination";

type TransactionsArgs = CommonOptions & {
  id?: string;
  from?: string;
  before?: string;
  page?: string;
  itemsPerPage?: string;
  pageAll?: boolean;
};

export default defineCommand({
  meta: {name: "transactions", description: "List transactions for a bank account"},
  args: withCommonArgs({
    id: {type: "positional", required: true, description: "accountId"},
    from: {type: "string", required: true, description: "start of date range (ISO 8601)"},
    before: {type: "string", required: true, description: "end of date range, exclusive (ISO 8601)"},
    page: {type: "string", default: "0", description: "page number (0-indexed)"},
    itemsPerPage: {type: "string", default: "20", description: "records per page"},
    pageAll: {type: "boolean", description: "auto-walk all pages"}
  }),
  run: runWithSdkKey<TransactionsArgs>(async (ctx, args) => {
    const path = `/api/bank/accounts/${encodeURIComponent(args.id as string)}/transactions`;
    const baseQuery = {
      from: args.from as string,
      before: args.before as string
    };

    if (ctx.dryRun) {
      ctx.print({
        method: "GET",
        path,
        query: {...baseQuery, page: args.page, itemsPerPage: args.itemsPerPage}
      });
      return;
    }

    if (args.pageAll) {
      const itemsPerPage = Number(args.itemsPerPage);
      const all = await walkAllPages({
        pageSize: itemsPerPage,
        fetchPage: async (page) => {
          const {data} = await ctx.http.request({
            method: "GET",
            path,
            query: {...baseQuery, page, itemsPerPage}
          });
          return data;
        }
      });
      ctx.print(all);
    } else {
      const {data} = await ctx.http.request({
        method: "GET",
        path,
        query: {...baseQuery, page: args.page, itemsPerPage: args.itemsPerPage}
      });
      ctx.print(data);
    }
  })
});
