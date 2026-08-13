import {V1_ROUTES} from "../../lib/v1-routes";
import type {CommandContext} from "../../lib/context";

export interface CustomSenderNameRow {
  id?: string;
  customSmsName?: string;
  status?: string;
  rejectRemarks?: string;
}

/** GET custom-sender-name; the backend returns `false` (not 404) when none exists yet. */
export async function fetchCustomSenderName(ctx: CommandContext): Promise<CustomSenderNameRow | null> {
  const {data} = await ctx.http.request({...V1_ROUTES.customSenderName.get});
  if (!data || data === false) return null;
  return data as CustomSenderNameRow;
}
