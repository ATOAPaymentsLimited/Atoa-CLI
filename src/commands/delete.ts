import {defineCommand} from "citty";
import {t} from "../lib/i18n";
import {confirm} from "@inquirer/prompts";
import {withCommonArgs, runWithSdkKey, type CommonOptions} from "./_common";

type DeleteArgs = CommonOptions & {path?: string};

export default defineCommand({
  meta: {name: "delete", description: t("cmdDelete")},
  args: withCommonArgs({
    path: {type: "positional", required: true, description: t("argApiPath")}
  }),
  // SDK-key authenticated, like the other raw-request commands: these are for poking the API
  // with a minted key, not for driving the browser-login session.
  run: runWithSdkKey<DeleteArgs>(async (ctx, args) => {
    const path = args.path as string;

    if (ctx.dryRun) {
      ctx.print({method: "DELETE", url: ctx.http.baseUrl + path});
      return;
    }

    if (!ctx.yes) {
      // Defaults to no: this sends a raw DELETE to any path, and the prompt itself says it
      // cannot be undone — an accidental Enter should not be the thing that confirms it.
      const ok = await confirm({message: t("confirmRawDelete", {path}), default: false});
      if (!ok) {
        process.stdout.write(t("aborted"));
        return;
      }
    }

    const {data} = await ctx.http.request({method: "DELETE", path});
    ctx.print(data);
  })
});
