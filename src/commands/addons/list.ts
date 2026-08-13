import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {isInteractive, renderKeyValues} from "../../lib/output";
import {
  fetchCurrentPlan,
  fetchAvailablePlans,
  fetchFeatureUsage,
  partitionByDirection,
  formatPlanChoice
} from "./_shared";

export default defineCommand({
  meta: {name: "list", description: "Show the current addon plan, subscribable plans and feature usage"},
  args: withCommonArgs({}),
  run: runWithContext<CommonOptions>(async (ctx) => {
    if (ctx.dryRun) {
      ctx.print({
        current: V1_ROUTES.addons.current,
        available: V1_ROUTES.addons.available,
        featureUsage: V1_ROUTES.addons.featureUsage
      });
      return;
    }

    // Independent reads served by different upstreams — fetch together so the command
    // costs one round-trip's latency rather than three.
    const [current, available, usage] = await Promise.all([
      fetchCurrentPlan(ctx),
      fetchAvailablePlans(ctx),
      fetchFeatureUsage(ctx)
    ]);

    const currentOrder = current.addonPlan?.planOrder ?? -1;
    const {upgrades, downgrades} = partitionByDirection(available.availablePlans ?? [], currentOrder);

    const out = {
      currentPlan: current.addonPlan
        ? {
            id: current.addonPlan.id,
            name: current.addonPlan.name,
            monthlyAmount: current.addonPlan.monthlyAmount,
            renewalType: current.renewalType,
            startDate: current.startDate,
            endDate: current.endDate
          }
        : null,
      featureUsage: usage,
      upgradeTo: upgrades.map((p) => ({id: p.id, name: p.name, monthlyAmount: p.monthlyAmount})),
      downgradeTo: downgrades.map((p) => ({id: p.id, name: p.name, monthlyAmount: p.monthlyAmount}))
    };

    if (!isInteractive(ctx.formatExplicit)) {
      ctx.print(out);
      return;
    }

    const rows: Array<[string, string | undefined]> = [
      ["Plan", current.addonPlan?.name],
      ["Price", current.addonPlan?.monthlyAmount != null ? `£${current.addonPlan.monthlyAmount}/mo` : undefined],
      ["Renewal", current.renewalType],
      ["Started", current.startDate],
      ["Ends", current.endDate]
    ];
    process.stdout.write(renderKeyValues("Addon plan", rows) + "\n\n");

    if (usage.length) {
      process.stdout.write(
        renderKeyValues(
          "Feature usage",
          usage.map((u) => [u.featureType, String(u.usage)] as [string, string])
        ) + "\n\n"
      );
    }
    if (upgrades.length) {
      process.stdout.write(`Upgrade to:\n${upgrades.map((p) => `  ${formatPlanChoice(p)}`).join("\n")}\n\n`);
    }
    if (downgrades.length) {
      process.stdout.write(`Downgrade to:\n${downgrades.map((p) => `  ${formatPlanChoice(p)}`).join("\n")}\n`);
    }
  })
});
