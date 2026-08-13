import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../../_common";
import {openBrowser} from "../../../lib/browser";
import {resolveDashboardUrl} from "../../../lib/env";
import {getActiveBusinessId} from "../../../lib/config-store";
import {AtoaError} from "../../../lib/errors";

type LinkArgs = CommonOptions & {open?: boolean};

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
  meta: {
    name: "link",
    description: "Get the card-signup dashboard deep-link for an already-KYB'd merchant (optionally open in browser)"
  },
  args: withCommonArgs({
    open: {
      type: "boolean",
      default: true,
      description: "open the URL in the default browser (--no-open to just print it)"
    }
  }),
  run: runWithContext<LinkArgs>(async (ctx, args) => {
    const businessId = await getActiveBusinessId(ctx.profileName);
    if (!businessId) {
      throw new AtoaError(
        `no active business for profile "${ctx.profileName}". Re-pair via \`atoa login\`.`,
        "validation"
      );
    }

    const url = buildCardSignupUrl(businessId);

    if (ctx.dryRun) {
      ctx.print({url, open: args.open ?? true});
      return;
    }

    if (args.open ?? true) {
      const opened = await openBrowser(url);
      if (!opened) {
        process.stderr.write("Could not open a browser automatically — open the URL below manually.\n");
      }
    }

    ctx.print({url});
  })
});
