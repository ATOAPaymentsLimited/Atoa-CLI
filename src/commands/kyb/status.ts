import {defineCommand} from "citty";
import {t} from "../../lib/i18n";
import {withCommonArgs, runWithContext} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {isInteractive, renderKeyValues} from "../../lib/output";
import {MerchantStatus} from "../../lib/enums";

/**
 * The backend `GET /api/merchant/:businessId/getKybStatus` returns an ad-hoc
 * object (no DTO). It always carries a `status`; when the merchant is REJECTED
 * it additionally carries `updatedAt`, `date`, `rejectRemarks` and per-check
 * `declinedCodes`. Everything is read defensively because the shape is untyped.
 */
interface KybStatus {
  status?: string;
  updatedAt?: string;
  date?: string | null;
  rejectRemarks?: string;
  declinedCodes?: {face?: unknown; document?: unknown; address?: unknown};
  [key: string]: unknown;
}

export default defineCommand({
  meta: {name: "status", description: t("cmdKybStatus")},
  args: withCommonArgs({}),
  run: runWithContext(async (ctx) => {
    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.kyb.status});
      return;
    }
    const {data} = await ctx.http.request({...V1_ROUTES.kyb.status});
    const kyb = (data ?? {}) as KybStatus;
    const approved = kyb.status === MerchantStatus.APPROVED;

    // Approved → just the status. Otherwise the merchant only cares why it was
    // rejected, so surface the reject remarks alone.
    const out = approved ? {status: kyb.status} : {rejectRemarks: kyb.rejectRemarks};

    // Scripting (piped, or explicit --output) keeps the machine-readable object;
    // an interactive terminal gets a labelled summary instead of raw JSON.
    if (!isInteractive(ctx.formatExplicit)) {
      ctx.print(out);
      return;
    }

    const rows: Array<[string, string | undefined]> = approved
      ? [[t("labelStatus"), kyb.status]]
      : [
          [t("labelStatus"), kyb.status],
          [t("labelReason"), kyb.rejectRemarks]
        ];
    process.stdout.write(renderKeyValues(t("titleKybVerification"), rows) + "\n");
  })
});
