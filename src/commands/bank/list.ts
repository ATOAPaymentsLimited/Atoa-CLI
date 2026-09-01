import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {fetchAllPages, presentList} from "../../lib/list-view";
import {projectBankAccount, type BankAccountRow} from "./_shared";
import {t} from "../../lib/i18n";

export default defineCommand({
  meta: {name: "list", description: "List bank accounts for the active business"},
  args: withCommonArgs({}),
  run: runWithContext<CommonOptions>(async (ctx) => {
    if (ctx.dryRun) {
      ctx.print(V1_ROUTES.bank.list);
      return;
    }

    // Bare array, no envelope; projected before display so the piped view can't print the
    // account number, or the IBAN containing it, in clear.
    const rows = (await fetchAllPages(ctx, V1_ROUTES.bank.list)).map((r) => projectBankAccount(r as BankAccountRow));
    await presentList(ctx, rows, {
      title: t("titleBankAccounts"),
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
