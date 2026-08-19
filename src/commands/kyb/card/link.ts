import {defineCommand} from "citty";
import {t} from "../../../lib/i18n";
import {withCommonArgs, runWithContext, type CommonOptions} from "../../_common";
import {openBrowser} from "../../../lib/browser";
import {resolveDashboardUrl} from "../../../lib/env";
import {getActiveBusinessId} from "../../../lib/config-store";
import {AtoaError} from "../../../lib/errors";
import {fetchKybStatus, assertKybSubmitted} from "../_shared";

/**
 * Builds the card-signup dashboard deep-link CLI-side. Same shape as
 * `kyb link` — there is no backend endpoint for this either.
 *
 * `kyb link` already reaches card activation for a NEW merchant — the card opt-in
 * gateway is folded into the main /verification KYB wizard. This command
 * covers the other case: an already-KYB'd merchant applying for card afterwards,
 * whose entry point is the standalone `/card-signup` layer, not `/verification`.
 */
function buildCardSignupUrl(businessId: string): string {
  const url = new URL("/card-signup", resolveDashboardUrl());
  url.searchParams.set("merchantId", businessId);
  return url.toString();
}

export default defineCommand({
  meta: {name: "link", description: t("cmdKybCardLink")},
  args: withCommonArgs({}),
  run: runWithContext<CommonOptions>(async (ctx) => {
    const businessId = await getActiveBusinessId(ctx.profileName);
    if (!businessId) {
      throw new AtoaError(t("noActiveBusinessForProfile", {name: ctx.profileName}), "validation");
    }

    const url = buildCardSignupUrl(businessId);

    if (ctx.dryRun) {
      ctx.print({url});
      return;
    }

    // Checked before opening: /card-signup silently redirects an unsubmitted merchant to /home,
    // so an unguarded handoff looks like a dead link. Refuse with the real precondition instead.
    assertKybSubmitted(await fetchKybStatus(ctx));

    const opened = await openBrowser(url);
    if (!opened) {
      process.stderr.write(t("couldNotOpenBrowser"));
    }

    ctx.print({url});
  })
});
