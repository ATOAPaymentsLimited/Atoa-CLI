import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {isInteractive} from "../../lib/output";
import {AtoaError} from "../../lib/errors";

export default defineCommand({
  meta: {name: "cancel-downgrade", description: "Cancel a scheduled downgrade and stay on the current plan"},
  args: withCommonArgs({}),
  run: runWithContext<CommonOptions>(async (ctx) => {
    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.addons.cancelDowngrade});
      return;
    }

    if (!ctx.yes) {
      if (!isInteractive(ctx.formatExplicit)) {
        throw new AtoaError("pass --yes to cancel the scheduled downgrade non-interactively", "validation");
      }
      const {confirm} = await import("@inquirer/prompts");
      const ok = await confirm({message: "Cancel the scheduled downgrade?", default: false});
      if (!ok) {
        process.stdout.write("Aborted.\n");
        return;
      }
    }

    const {data} = await ctx.http.request({...V1_ROUTES.addons.cancelDowngrade});
    ctx.print(data ?? {cancelled: true});
  })
});
