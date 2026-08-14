import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {isInteractive} from "../../lib/output";
import {AtoaError} from "../../lib/errors";

interface StoreLocationRow {
  merchantStoreId?: string;
}

export default defineCommand({
  meta: {name: "unlink", description: "Disconnect this business's Google Business Profile"},
  args: withCommonArgs({}),
  run: runWithContext<CommonOptions>(async (ctx) => {
    const interactive = isInteractive(ctx.formatExplicit);
    if (!ctx.yes) {
      if (!interactive)
        throw new AtoaError("pass --yes to unlink without a confirmation prompt (non-interactive)", "validation");
      const {confirm} = await import("@inquirer/prompts");
      const ok = await confirm({
        message: "Disconnect Google Business Profile and unlink all its store locations?",
        default: false
      });
      if (!ok) return;
    }

    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.googleReview.unlinkConfig, query: {deleteConfig: "true"}});
      return;
    }

    // Config unlink alone doesn't clear per-store links — unlink each linked store
    // location first, then delete the merchant-level config.
    // Only a 404 means "nothing linked yet". Any other failure (5xx, timeout, auth) leaves us
    // unable to tell an empty list from an unreadable one — and proceeding would delete the
    // merchant-level config while orphaning every store link server-side. Fail loudly instead.
    let locations: StoreLocationRow[] = [];
    try {
      const {data} = await ctx.http.request({...V1_ROUTES.googleReview.storeLocations});
      locations = (data ?? []) as StoreLocationRow[];
    } catch (err) {
      if (!(err instanceof AtoaError) || err.kind !== "not_found") {
        throw new AtoaError(
          `Could not read the linked store locations, so unlinking was stopped before changing anything ` +
            `(${err instanceof AtoaError ? err.message : String(err)}). Retry once the review service is reachable.`,
          err instanceof AtoaError ? err.kind : "generic",
          err instanceof AtoaError
            ? {status: err.status, errorCode: err.errorCode, requestId: err.requestId}
            : undefined
        );
      }
      locations = []; // genuine 404 — nothing linked, safe to delete the config
    }
    for (const loc of locations) {
      if (!loc.merchantStoreId) continue;
      await ctx.http.request({
        ...V1_ROUTES.googleReview.unlinkLocation,
        pathParams: {merchantStoreId: loc.merchantStoreId}
      });
    }

    await ctx.http.request({...V1_ROUTES.googleReview.unlinkConfig, query: {deleteConfig: "true"}});
    ctx.print({unlinked: true});
  })
});
