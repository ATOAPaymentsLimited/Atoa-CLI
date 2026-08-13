import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";

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
    const {data} = await ctx.http.request({...V1_ROUTES.directDebit.assignedPlan});
    const plan = (data ?? {}) as {isDirectDebitSetup?: boolean; stripeCustomer?: {mandateDetails?: {status?: string}}};
    ctx.print({
      isDirectDebitSetup: plan.isDirectDebitSetup,
      mandateStatus: plan.stripeCustomer?.mandateDetails?.status
    });
  })
});
