import {defineCommand} from "citty";
import {withCommonArgs, runWithContext} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {fetchAllPages, presentList} from "../../lib/list-view";

export default defineCommand({
  meta: {
    name: "list",
    description: "List active CLI/MCP sessions for this account."
  },
  args: withCommonArgs({}),
  run: runWithContext(async (ctx) => {
    const rows = await fetchAllPages(ctx, V1_ROUTES.sessions.list);
    await presentList(ctx, rows, {
      title: "Sessions",
      line: (s) => [s["deviceName"] || s["source"], s["source"], s["id"]].filter(Boolean).join("  ·  ")
    });
  })
});
