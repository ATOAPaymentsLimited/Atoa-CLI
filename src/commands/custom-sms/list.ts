import {defineCommand} from "citty";
import {t} from "../../lib/i18n";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {isInteractive} from "../../lib/output";
import {fetchCustomSenderName} from "./_shared";

export default defineCommand({
  meta: {name: "list", description: t("cmdCustomSmsList")},
  args: withCommonArgs({}),
  run: runWithContext<CommonOptions>(async (ctx) => {
    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.customSenderName.get});
      return;
    }
    const existing = await fetchCustomSenderName(ctx);
    if (!existing) {
      if (isInteractive(ctx.formatExplicit)) {
        process.stdout.write(t("noCustomSmsNameSetHint"));
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
