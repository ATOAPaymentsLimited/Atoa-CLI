import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {isInteractive} from "../../lib/output";
import {AtoaError} from "../../lib/errors";
import {fetchCurrentPlan, fetchAvailablePlans, partitionByDirection, resolveTargetPlan} from "./_shared";

type UpgradeArgs = CommonOptions & {planId?: string};

export default defineCommand({
  meta: {name: "upgrade", description: "Move this business to a higher addon plan (changes billing)"},
  args: withCommonArgs({
    planId: {type: "positional", required: false, description: "target plan ID (omit to pick from a list on a TTY)"}
  }),
  run: runWithContext<UpgradeArgs>(async (ctx, args) => {
    const [current, available] = await Promise.all([fetchCurrentPlan(ctx), fetchAvailablePlans(ctx)]);
    const currentOrder = current.addonPlan?.planOrder ?? -1;
    const {upgrades} = partitionByDirection(available.availablePlans ?? [], currentOrder);

    const target = await resolveTargetPlan(upgrades, args.planId?.trim(), {
      interactive: isInteractive(ctx.formatExplicit),
      verb: "upgrade"
    });

    if (ctx.dryRun) {
      ctx.print({
        ...V1_ROUTES.addons.upgrade,
        pathParams: {addonPlanId: target.id},
        from: current.addonPlan?.name,
        to: target.name,
        monthlyAmount: target.monthlyAmount
      });
      return;
    }

    // Billing change — always confirm unless explicitly waived.
    if (!ctx.yes) {
      if (!isInteractive(ctx.formatExplicit)) {
        throw new AtoaError("pass --yes to change the plan without a confirmation prompt", "validation");
      }
      const {confirm} = await import("@inquirer/prompts");
      const ok = await confirm({
        message: `Upgrade from ${current.addonPlan?.name ?? "current plan"} to ${target.name} (£${target.monthlyAmount}/mo)?`,
        default: false
      });
      if (!ok) {
        process.stdout.write("Aborted.\n");
        return;
      }
    }

    const {data} = await ctx.http.request({...V1_ROUTES.addons.upgrade, pathParams: {addonPlanId: target.id}});
    ctx.print(data ?? {upgradedTo: target.name});
  })
});
