import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {walkAllPages} from "../../lib/pagination";

type ListArgs = CommonOptions & {
  page?: string;
  limit?: string;
  fromDate?: string;
  toDate?: string;
  orderBy?: string;
  status?: string;
  search?: string;
  pageAll?: boolean;
};

export default defineCommand({
  meta: {name: "list", description: "List payouts"},
  args: withCommonArgs({
    page: {type: "string", default: "0", description: "page number (0-indexed)"},
    limit: {type: "string", default: "20", description: "page size"},
    fromDate: {type: "string", description: "start date filter (ISO 8601)"},
    toDate: {type: "string", description: "end date filter (ISO 8601)"},
    orderBy: {type: "string", description: "field to sort results by"},
    status: {type: "string", description: "filter payouts by status"},
    search: {type: "string", description: "free-text search"},
    pageAll: {type: "boolean", description: "auto-walk all pages"}
  }),
  run: runWithContext<ListArgs>(async (ctx, args) => {
    const filters: Record<string, string> = {
      ...(args.fromDate && {fromDate: args.fromDate}),
      ...(args.toDate && {toDate: args.toDate}),
      ...(args.orderBy && {orderBy: args.orderBy}),
      ...(args.status && {status: args.status}),
      ...(args.search && {search: args.search})
    };

    if (ctx.dryRun) {
      ctx.print({
        method: "GET",
        path: "/api/payouts",
        query: {page: args.page, limit: args.limit, ...filters}
      });
      return;
    }

    if (args.pageAll) {
      const limit = Number(args.limit);
      const all = await walkAllPages({
        pageSize: limit,
        fetchPage: async (page) => {
          const {data} = await ctx.http.request({
            method: "GET",
            path: "/api/payouts",
            query: {page, limit, ...filters}
          });
          return data;
        }
      });
      ctx.print(all);
    } else {
      const {data} = await ctx.http.request({
        method: "GET",
        path: "/api/payouts",
        query: {page: args.page, limit: args.limit, ...filters}
      });
      ctx.print(data);
    }
  })
});
