import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {fetchAssignedPlan, hasActiveMandate} from "./_shared";

export default defineCommand({
  meta: {
    name: "status",
    description: "Show the direct-debit mandate status for platform fees"
  },
  args: withCommonArgs({}),
  run: runWithContext<CommonOptions>(async (ctx) => {
    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.directDebit.assignedPlan});
      return;
    }
    const plan = await fetchAssignedPlan(ctx);
    if (!plan) {
      // No plan assigned means there is nothing for a mandate to pay for yet. That is a state
      // to report, not a failure — the backend just expresses it as an error.
      ctx.print({isDirectDebitSetup: false, mandateStatus: "NO_PLAN_ASSIGNED"});
      return;
    }

    const isSetup = hasActiveMandate(plan);
    ctx.print({
      isDirectDebitSetup: isSetup,
      // A merchant with no mandate has no status to report; saying so beats an empty cell,
      // which reads as "the CLI failed to fetch it".
      mandateStatus: plan.stripeCustomer?.mandateDetails?.status ?? (isSetup ? undefined : "NOT_SET_UP")
    });
  })
});
