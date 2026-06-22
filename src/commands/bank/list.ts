import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {fetchAllPages, presentList} from "../../lib/list-view";

export default defineCommand({
  meta: {name: "list", description: "List bank accounts for the active business"},
  args: withCommonArgs({}),
  run: runWithContext<CommonOptions>(async (ctx) => {
    if (ctx.dryRun) {
      ctx.print(V1_ROUTES.bank.list);
      return;
    }

    // Returns a bare MerchantBankAccountEntity[]; fetchAllPages passes it straight through.
    const rows = await fetchAllPages(ctx, V1_ROUTES.bank.list);
    await presentList(ctx, rows, {
      title: "Bank accounts",
      line: (b) =>
        [
          b["nickName"] || b["bankName"],
          b["maskedAccountNumber"],
          b["sortCode"],
          b["enabled"] === false ? "(disabled)" : null
        ]
          .filter(Boolean)
          .join("  ·  ")
    });
  })
});
