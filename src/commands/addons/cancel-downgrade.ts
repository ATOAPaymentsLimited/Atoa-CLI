import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {isInteractive} from "../../lib/output";
import {AtoaError} from "../../lib/errors";
import {fetchCurrentPlan} from "./_shared";
import {t} from "../../lib/i18n";

export default defineCommand({
  meta: {name: "cancel-downgrade", description: t("cmdAddonsCancelDowngrade")},
  args: withCommonArgs({}),
  run: runWithContext<CommonOptions>(async (ctx) => {
    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.addons.cancelDowngrade});
      return;
    }

    if (!ctx.yes) {
      if (!isInteractive(ctx.formatExplicit)) {
        throw new AtoaError(t("passYesToCancelDowngrade"), "validation");
      }
      const {confirm} = await import("@inquirer/prompts");
      const ok = await confirm({message: t("cancelDowngradePrompt"), default: false});
      if (!ok) {
        process.stdout.write(t("aborted"));
        return;
      }
    }

    await ctx.http.request({...V1_ROUTES.addons.cancelDowngrade});

    // The endpoint answers with a bare `true`, which tells a reader nothing. Report the
    // outcome and the plan that is now being stayed on.
    const current = await fetchCurrentPlan(ctx).catch(() => undefined);
    ctx.print({
      status: t("downgradeCancelled"),
      stayingOn: current?.addonPlan?.name,
      monthlyAmount: current?.addonPlan?.monthlyAmount
    });
  })
});
