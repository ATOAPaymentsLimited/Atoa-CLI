import {defineCommand} from "citty";
import {withCommonArgs, runWithContext} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";

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
  meta: {name: "status", description: "Get the KYB verification status for this business"},
  args: withCommonArgs({}),
  run: runWithContext(async (ctx) => {
    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.kyb.status});
      return;
    }
    const {data} = await ctx.http.request({...V1_ROUTES.kyb.status});
    const kyb = (data ?? {}) as KybStatus;

    // Surface the headline status plus any rejection detail the backend included.
    const out: Record<string, unknown> = {status: kyb.status};
    if (kyb.rejectRemarks !== undefined) out["rejectRemarks"] = kyb.rejectRemarks;
    if (kyb.declinedCodes !== undefined) out["declinedCodes"] = kyb.declinedCodes;
    if (kyb.updatedAt !== undefined) out["updatedAt"] = kyb.updatedAt;
    if (kyb.date !== undefined && kyb.date !== null) out["date"] = kyb.date;

    ctx.print(out);
  })
});
