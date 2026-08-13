import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {isInteractive} from "../../lib/output";
import {fetchCustomSenderName} from "./_shared";

export default defineCommand({
  meta: {name: "list", description: "Show the custom SMS sender name for this business"},
  args: withCommonArgs({}),
  run: runWithContext<CommonOptions>(async (ctx) => {
    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.customSenderName.get});
      return;
    }
    const existing = await fetchCustomSenderName(ctx);
    if (!existing) {
      if (isInteractive(ctx.formatExplicit)) {
        process.stdout.write("no custom SMS sender name set — use `atoa sms-name set <name>`\n");
        return;
      }
      ctx.print(null);
      return;
    }
    ctx.print({
      id: existing.id,
      customSmsName: existing.customSmsName,
      status: existing.status,
      rejectRemarks: existing.rejectRemarks
    });
  })
});
