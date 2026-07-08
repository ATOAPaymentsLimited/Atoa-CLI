import {defineCommand} from "citty";
import {withCommonArgs, runWithSdkKey} from "../_common";
import {presentList} from "../../lib/list-view";

export default defineCommand({
  meta: {name: "list", description: "List available payment institutions (banks)"},
  args: withCommonArgs({}),
  run: runWithSdkKey(async (ctx) => {
    if (ctx.dryRun) {
      ctx.print({method: "GET", path: "/api/institutions"});
      return;
    }

    // /api/institutions returns a bare array; the scroll view shows a one-line summary per bank
    // (the full record — media/features etc. — is shown when you select one, or via --output json).
    const {data} = await ctx.http.request({method: "GET", path: "/api/institutions"});
    const rows = Array.isArray(data) ? data : [];
    await presentList(ctx, rows, {
      title: "Institutions",
      line: (b) =>
        [b["fullName"] || b["name"], b["businessBank"] ? "Business" : "Personal"].filter(Boolean).join("  ·  ")
    });
  })
});
