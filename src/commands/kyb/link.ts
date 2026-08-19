import {defineCommand} from "citty";
import {t} from "../../lib/i18n";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {openBrowser} from "../../lib/browser";
import {resolveDashboardUrl} from "../../lib/env";
import {getActiveBusinessId} from "../../lib/config-store";
import {AtoaError} from "../../lib/errors";

/**
 * Builds the KYB dashboard deep-link CLI-side.
 *
 * There is no backend endpoint for this — we concatenate the dashboard origin
 * (`resolveDashboardUrl()`: runtime `ATOA_DASHBOARD_URL` → compile-time define
 * → default) with the dashboard's KYB verification route, which reads the business
 * id from the `merchantId` query param. The active business id comes from the
 * profile's stored `activeBusinessId` (same source `http.ts` uses to fill `:businessId`).
 */
function buildKybUrl(businessId: string): string {
  const url = new URL("/verification", resolveDashboardUrl());
  url.searchParams.set("merchantId", businessId);
  return url.toString();
}

export default defineCommand({
  meta: {name: "link", description: t("cmdKybLink")},
  args: withCommonArgs({}),
  run: runWithContext<CommonOptions>(async (ctx) => {
    const businessId = await getActiveBusinessId(ctx.profileName);
    if (!businessId) {
      throw new AtoaError(t("noActiveBusinessForProfile", {name: ctx.profileName}), "validation");
    }

    const url = buildKybUrl(businessId);

    if (ctx.dryRun) {
      ctx.print({url});
      return;
    }

    // Always opened, the same way `login` does it — the command exists to get the merchant
    // in front of the form, not to hand them a URL to paste. The URL is printed regardless
    // so there is something to fall back on when no browser can be launched.
    const opened = await openBrowser(url);
    if (!opened) {
      process.stderr.write(t("couldNotOpenBrowser"));
    }

    ctx.print({url});
  })
});
