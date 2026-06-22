import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {openBrowser} from "../../lib/browser";
import {resolveDashboardUrl} from "../../lib/env";
import {getActiveBusinessId} from "../../lib/config-store";
import {AtoaError} from "../../lib/errors";

type LinkArgs = CommonOptions & {open?: boolean};

/**
 * Builds the KYB dashboard deep-link CLI-side.
 *
 * There is no backend endpoint for this — the old `/v1` controller just
 * concatenated the dashboard origin and the business id, so we do the same
 * here against `resolveDashboardUrl()` (runtime `ATOA_DASHBOARD_URL` →
 * compile-time define → default). The active business id comes from the
 * profile's stored `activeBusinessId` (same source `http.ts` uses to fill
 * `:businessId`).
 */
function buildKybUrl(businessId: string): string {
  const url = new URL("/kyb", resolveDashboardUrl());
  url.searchParams.set("businessId", businessId);
  return url.toString();
}

export default defineCommand({
  meta: {name: "link", description: "Get the KYB dashboard deep-link (optionally open in browser)"},
  args: withCommonArgs({
    open: {type: "boolean", description: "open the URL in the default browser"}
  }),
  run: runWithContext<LinkArgs>(async (ctx, args) => {
    const businessId = await getActiveBusinessId(ctx.profileName);
    if (!businessId) {
      throw new AtoaError(
        `no active business for profile "${ctx.profileName}". Re-pair via \`atoa login\`.`,
        "validation"
      );
    }

    const url = buildKybUrl(businessId);

    if (ctx.dryRun) {
      ctx.print({url, open: args.open ?? false});
      return;
    }

    if (args.open) {
      await openBrowser(url);
    }

    ctx.print({url});
  })
});
