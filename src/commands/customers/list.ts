import {defineCommand} from "citty";
import {withCommonArgs, runWithSdkKey, type CommonOptions} from "../_common";
import {fetchAllPages, presentList} from "../../lib/list-view";

type ListArgs = CommonOptions & {search?: string};

const CUSTOMERS_ROUTE = {method: "GET", path: "/api/customers", auth: "sdk"} as const;

export default defineCommand({
  meta: {name: "list", description: "List customers"},
  args: withCommonArgs({
    search: {type: "string", description: "name/email search filter"}
  }),
  run: runWithSdkKey<ListArgs>(async (ctx, args) => {
    const baseQuery: Record<string, string> = {...(args.search && {search: args.search})};

    if (ctx.dryRun) {
      ctx.print({...CUSTOMERS_ROUTE, query: baseQuery});
      return;
    }

    // Paginated endpoint — fetchAllPages walks every page, presentList shows a scrollable picker
    // (Enter for full detail) on an interactive TTY, or the raw rows when piped / --output.
    const rows = await fetchAllPages(ctx, CUSTOMERS_ROUTE, baseQuery);
    await presentList(ctx, rows, {
      title: "Customers",
      line: (c) => {
        const phone = c["phoneNumber"]
          ? [c["phoneCountryCode"] && `+${c["phoneCountryCode"]}`, c["phoneNumber"]].filter(Boolean).join(" ")
          : undefined;
        return [c["fullName"], c["email"], phone, c["type"]].filter(Boolean).join("  ·  ");
      }
    });
  })
});
