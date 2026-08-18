import {V1_ROUTES} from "../../lib/v1-routes";
import {AtoaError} from "../../lib/errors";
import {MerchantStatus, KYB_NOT_SUBMITTED} from "../../lib/enums";
import {t} from "../../lib/i18n";
import type {CommandContext} from "../../lib/context";

export async function fetchKybStatus(ctx: CommandContext): Promise<string | undefined> {
  const {data} = await ctx.http.request({...V1_ROUTES.kyb.status});
  return ((data ?? {}) as {status?: string}).status;
}

/**
 * Refuses the card-signup handoff when KYB isn't submitted.
 *
 * The card-signup page redirects these merchants away, so opening the link anyway looks like a
 * broken deep-link rather than an unmet precondition. Checking here names the actual blocker.
 */
export function assertKybSubmitted(status: string | undefined): void {
  if (status === MerchantStatus.REJECTED) {
    throw new AtoaError(t("kybRejected"), "validation");
  }
  if (!status || KYB_NOT_SUBMITTED.includes(status as MerchantStatus)) {
    throw new AtoaError(t("kybNotSubmitted"), "validation");
  }
}
