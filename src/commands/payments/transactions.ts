import {defineCommand} from "citty";
import {withCommonArgs, runWithSdkKey, type CommonOptions} from "../_common";
import {walkAllPages} from "../../lib/pagination";

type ListArgs = CommonOptions & {
  page?: string;
  size?: string;
  pageAll?: boolean;
  from?: string;
  to?: string;
  status?: string;
  atoaCustomerIds?: string;
  paymentMethod?: string;
  storeIds?: string;
};

export default defineCommand({
  meta: {name: "transactions", description: "List payment transactions (POST filter endpoint)"},
  args: withCommonArgs({
    page: {type: "string", default: "0", description: "page number (0-indexed)"},
    size: {type: "string", default: "20", description: "page size"},
    pageAll: {type: "boolean", description: "auto-walk all pages"},
    from: {type: "string", description: "fromDate ISO 8601"},
    to: {type: "string", description: "toDate ISO 8601"},
    status: {type: "string", description: "comma-separated transaction status filter (e.g. COMPLETED,FAILED)"},
    atoaCustomerIds: {type: "string", description: "comma-separated customer IDs"},
    paymentMethod: {type: "string", description: "comma-separated payment methods (PAY_BY_BANK, CARD)"},
    storeIds: {type: "string", description: "comma-separated store IDs"}
  }),
  run: runWithSdkKey<ListArgs>(async (ctx, args) => {
    const split = (v?: string) => (v ? v.split(",").map((s) => s.trim()) : undefined);

    const filters = {
      ...(args.from && {fromDate: args.from}),
      ...(args.to && {toDate: args.to}),
      ...(args.status && {status: split(args.status)}),
      ...(args.paymentMethod && {paymentMethod: split(args.paymentMethod)}),
      ...(args.atoaCustomerIds && {atoaCustomerIds: split(args.atoaCustomerIds)}),
      ...(args.storeIds && {storeIds: split(args.storeIds)})
    };

    if (ctx.dryRun) {
      ctx.print({
        method: "POST",
        path: "/api/payments/transactions",
        query: {page: args.page, size: args.size},
        body: filters
      });
      return;
    }

    if (args.pageAll) {
      const size = Number(args.size);
      const all = await walkAllPages({
        pageSize: size,
        fetchPage: async (page) => {
          const {data} = await ctx.http.request({
            method: "POST",
            path: "/api/payments/transactions",
            query: {page, size},
            body: filters
          });
          return data;
        }
      });
      ctx.print(all);
    } else {
      const {data} = await ctx.http.request({
        method: "POST",
        path: "/api/payments/transactions",
        query: {page: args.page, size: args.size},
        body: filters
      });
      ctx.print(data);
    }
  })
});
