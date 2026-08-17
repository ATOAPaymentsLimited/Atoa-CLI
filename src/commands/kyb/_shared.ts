import {V1_ROUTES} from "../../lib/v1-routes";
import {AtoaError} from "../../lib/errors";
import type {CommandContext} from "../../lib/context";

/**
 * KYB states that mean "verification has not been submitted".
 *
 * This is the same set the /card-signup page gates on. If the two drift apart, the CLI either
 * refuses a handoff that would have worked, or sends the user to a page that silently
 * redirects them to /home.
 */
const KYB_NOT_SUBMITTED = ["PENDING", "REJECTED"];

export async function fetchKybStatus(ctx: CommandContext): Promise<string | undefined> {
  const {data} = await ctx.http.request({...V1_ROUTES.kyb.status});
  return ((data ?? {}) as {status?: string}).status;
}

/**
 * Refuses the card-signup handoff when KYB isn't submitted.
 *
 * The card-signup page redirects these
 * merchants to /home, so opening the link anyway looks like a broken deep-link rather than
 * an unmet precondition. Checking here names the actual blocker instead.
 */
export function assertKybSubmitted(status: string | undefined): void {
  if (status === "REJECTED") {
    throw new AtoaError(
      "business verification was rejected — card payments can't be applied for until it passes. " +
        "Run `atoa kyb status` for the reason, then `atoa kyb link` to resubmit.",
      "validation"
    );
  }
  if (!status || KYB_NOT_SUBMITTED.includes(status)) {
    throw new AtoaError(
      "business verification hasn't been submitted yet — submit KYB first with `atoa kyb link`.",
      "validation"
    );
  }
}
