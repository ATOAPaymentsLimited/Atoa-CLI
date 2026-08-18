import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {isInteractive} from "../../lib/output";
import {AtoaError} from "../../lib/errors";
import {
  fetchCurrentPlan,
  fetchAvailablePlans,
  fetchFeatureUsage,
  partitionByDirection,
  resolveTargetPlan,
  downgradeBlockers
} from "./_shared";
import {t} from "../../lib/i18n";

type DowngradeArgs = CommonOptions & {planId?: string};

export default defineCommand({
  meta: {name: "downgrade", description: "Move this business to a lower addon plan (takes effect next billing cycle)"},
  args: withCommonArgs({
    planId: {type: "positional", required: false, description: "target plan ID (omit to pick from a list on a TTY)"}
  }),
  run: runWithContext<DowngradeArgs>(async (ctx, args) => {
    const [current, available, usage] = await Promise.all([
      fetchCurrentPlan(ctx),
      fetchAvailablePlans(ctx),
      fetchFeatureUsage(ctx)
    ]);
    const currentOrder = current.addonPlan?.planOrder ?? -1;
    const {downgrades} = partitionByDirection(available.availablePlans ?? [], currentOrder);

    const target = await resolveTargetPlan(downgrades, args.planId?.trim(), {
      interactive: isInteractive(ctx.formatExplicit),
      verb: "downgrade"
    });

    // The backend enforces this too, but its 428 names no feature — so surface the specific
    // blockers up front rather than after a failed round-trip.
    const blockers = downgradeBlockers(usage, target);

    if (ctx.dryRun) {
      ctx.print({
        ...V1_ROUTES.addons.downgrade,
        pathParams: {addonPlanId: target.id},
        from: current.addonPlan?.name,
        to: target.name,
        blockers
      });
      return;
    }

    if (blockers.length) {
      throw new AtoaError(
        `Cannot downgrade to ${target.name} — current usage exceeds that plan:\n` +
          blockers.map((b) => `  • ${b}`).join("\n") +
          "\nReduce usage first, then retry.",
        "validation"
      );
    }

    let estimate: {estimatedCharges?: number; downgradeDate?: string} = {};
    try {
      const {data} = await ctx.http.request({...V1_ROUTES.addons.estimatedCharges});
      estimate = (data ?? {}) as typeof estimate;
    } catch {
      estimate = {}; // advisory only — never block the downgrade on the estimate
    }

    if (!ctx.yes) {
      if (!isInteractive(ctx.formatExplicit)) {
        throw new AtoaError(t("passYesToChangePlan"), "validation");
      }
      const when = estimate.downgradeDate ? ` It takes effect ${estimate.downgradeDate}.` : "";
      const charges = estimate.estimatedCharges != null ? ` Estimated charges: £${estimate.estimatedCharges}.` : "";
      const {confirm} = await import("@inquirer/prompts");
      const ok = await confirm({
        message: `Downgrade from ${current.addonPlan?.name ?? "current plan"} to ${target.name} (£${target.monthlyAmount}/mo)?${when}${charges}`,
        default: false
      });
      if (!ok) {
        process.stdout.write("Aborted.\n");
        return;
      }
    }

    try {
      await ctx.http.request({...V1_ROUTES.addons.downgrade, pathParams: {addonPlanId: target.id}});
      // The endpoint echoes the whole plan record back. A merchant who just confirmed a
      // downgrade wants to know it is scheduled and when it lands — not to re-read the plan.
      ctx.print({
        status: t("downgradeScheduled"),
        from: current.addonPlan?.name,
        to: target.name,
        monthlyAmount: target.monthlyAmount,
        effectiveFrom: estimate.downgradeDate,
        estimatedCharges: estimate.estimatedCharges
      });
    } catch (err) {
      throw withBlockerDetail(err, blockers);
    }
  })
});

/**
 * The backend's downgrade refusal is a 428 with a single generic message. If our own
 * check disagreed (it said fine, the backend said no), the backend is right — but we can
 * still point at the usage that most likely caused it.
 */
function withBlockerDetail(err: unknown, blockers: string[]): unknown {
  if (!(err instanceof AtoaError) || err.status !== 428) return err;
  const detail = blockers.length
    ? `\n${blockers.map((b) => `  • ${b}`).join("\n")}`
    : "\nRun `atoa addons list` to compare current usage against the target plan.";
  return new AtoaError(`${err.message}${detail}`, err.kind, {
    status: err.status,
    errorCode: err.errorCode,
    requestId: err.requestId,
    additionalData: err.additionalData
  });
}
