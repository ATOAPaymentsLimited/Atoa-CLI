import {defineCommand} from "citty";
import {t} from "../../lib/i18n";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {isInteractive, renderKeyValues} from "../../lib/output";
import {
  fetchCurrentPlan,
  fetchAvailablePlans,
  fetchFeatureUsage,
  partitionByDirection,
  formatPlanChoice,
  formatFeatureUsage,
  toUsageRows,
  type AddonPlan,
  type CurrentPlan,
  type UsageRow
} from "./_shared";

const planList = (plans: AddonPlan[]): string =>
  plans.map((p) => t("planListItem", {plan: formatPlanChoice(p)})).join("");

export default defineCommand({
  meta: {name: "list", description: t("cmdAddonsList")},
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
    const usageRows = toUsageRows(usage, current.addonPlan);

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
      featureUsage: usageRows,
      upgradeTo: upgrades.map((p) => ({id: p.id, name: p.name, monthlyAmount: p.monthlyAmount})),
      downgradeTo: downgrades.map((p) => ({id: p.id, name: p.name, monthlyAmount: p.monthlyAmount}))
    };

    if (!isInteractive(ctx.formatExplicit)) {
      ctx.print(out);
      return;
    }

    printPlanSummary(current, usageRows, upgrades, downgrades);
  })
});

/** The human view: the current plan, then usage, then where you can move to. */
function printPlanSummary(
  current: CurrentPlan,
  usageRows: UsageRow[],
  upgrades: AddonPlan[],
  downgrades: AddonPlan[]
): void {
  const monthly = current.addonPlan?.monthlyAmount;
  const rows: Array<[string, string | undefined]> = [
    [t("labelPlan"), current.addonPlan?.name],
    [t("labelPrice"), monthly != null ? t("planPriceMonthly", {amount: monthly}) : undefined],
    [t("labelRenewal"), current.renewalType],
    [t("labelStarted"), current.startDate],
    [t("labelEnds"), current.endDate]
  ];
  process.stdout.write(renderKeyValues(t("titleAddonPlan"), rows) + "\n\n");

  if (usageRows.length) {
    process.stdout.write(
      renderKeyValues(
        t("titleFeatureUsage"),
        usageRows.map(
          (u) => [u.featureType, formatFeatureUsage(u.usage, u.included ? u : undefined)] as [string, string]
        )
      ) + "\n\n"
    );
  }
  if (upgrades.length) {
    process.stdout.write(t("headingUpgradeTo") + planList(upgrades) + "\n");
  }
  if (downgrades.length) {
    process.stdout.write(t("headingDowngradeTo") + planList(downgrades));
  }
}
