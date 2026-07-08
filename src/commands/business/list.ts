import {defineCommand} from "citty";
import {withCommonArgs, runWithContext} from "../_common";
import {getActiveBusinessId} from "../../lib/config-store";
import {V1_ROUTES} from "../../lib/v1-routes";
import {presentList} from "../../lib/list-view";
import {normalizeBusinesses} from "../../lib/businesses";

export default defineCommand({
  meta: {
    name: "list",
    description: "List businesses associated with this account and mark the active one."
  },
  args: withCommonArgs({}),
  run: runWithContext(async (ctx) => {
    // /api/business/ returns {business: BusinessToUser[], ...} — not paginated — so fetch once.
    const {data} = await ctx.http.request({...V1_ROUTES.businesses.list});
    const businesses = normalizeBusinesses(data);
    const activeId = await getActiveBusinessId(ctx.profileName);

    // Hide unnamed business shells (created via step-1 but not yet given a legal name) — but always
    // keep the active business, so the current one never disappears from the list.
    const named = businesses.filter((b) => (b.legalBusinessName || "").trim() || b.id === activeId);
    const annotated = named.map((b) => ({...b, active: b.id === activeId}));

    await presentList(ctx, annotated, {
      title: "Businesses",
      line: (b) =>
        [b["legalBusinessName"] || "(unnamed)", b["status"], b["active"] ? "✓ active" : ""]
          .filter(Boolean)
          .join("  ·  ")
    });
  })
});
