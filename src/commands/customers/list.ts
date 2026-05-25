import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {walkAllPages} from "../../lib/pagination";

type ListArgs = CommonOptions & {
  page?: string;
  size?: string;
  search?: string;
  pageAll?: boolean;
};

export default defineCommand({
  meta: {name: "list", description: "List customers"},
  args: withCommonArgs({
    page: {type: "string", default: "0", description: "page number (0-indexed)"},
    size: {type: "string", default: "20", description: "page size"},
    search: {type: "string", description: "name/email search filter"},
    pageAll: {type: "boolean", description: "auto-walk all pages"}
  }),
  run: runWithContext<ListArgs>(async (ctx, args) => {
    const baseQuery: Record<string, string> = {
      ...(args.search && {search: args.search})
    };

    if (ctx.dryRun) {
      ctx.print({
        method: "GET",
        path: "/api/customers",
        query: {page: args.page, size: args.size, ...baseQuery}
      });
      return;
    }

    if (args.pageAll) {
      const size = Number(args.size);
      const all = await walkAllPages({
        pageSize: size,
        fetchPage: async (page) => {
          const {data} = await ctx.http.request({
            method: "GET",
            path: "/api/customers",
            query: {page, size, ...baseQuery}
          });
          return data;
        }
      });
      ctx.print(all);
    } else {
      const {data} = await ctx.http.request({
        method: "GET",
        path: "/api/customers",
        query: {page: args.page, size: args.size, ...baseQuery}
      });
      ctx.print(data);
    }
  })
});
