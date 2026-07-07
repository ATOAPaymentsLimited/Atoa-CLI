import {defineCommand} from "citty";
import {confirm} from "@inquirer/prompts";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {AtoaError} from "../../lib/errors";
import {V1_ROUTES} from "../../lib/v1-routes";

type RevokeSessionArgs = CommonOptions & {deviceId: string};

export default defineCommand({
  meta: {
    name: "revoke",
    description: "Revoke a session by device ID. Warning: revoking the current device session will log this CLI out."
  },
  args: withCommonArgs({
    deviceId: {
      type: "positional",
      required: true,
      description: "device ID to revoke (from `atoa sessions list`)"
    }
  }),
  run: runWithContext<RevokeSessionArgs>(async (ctx, args) => {
    const deviceId = (args.deviceId as string | undefined)?.trim();
    if (!deviceId) {
      throw new AtoaError("deviceId is required", "validation");
    }

    if (!ctx.yes) {
      if (!process.stdin.isTTY) {
        throw new AtoaError("Non-interactive mode requires --yes to confirm session revocation.", "validation");
      }
      const ok = await confirm({
        message:
          `Revoke session "${deviceId}"?\n` + `Warning: if this is the current device, this CLI will be logged out.`
      });
      if (!ok) {
        process.stdout.write("Aborted.\n");
        return;
      }
    }

    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.sessions.delete, pathParams: {deviceId}});
      return;
    }

    await ctx.http.request({
      ...V1_ROUTES.sessions.delete,
      pathParams: {deviceId}
    });

    ctx.print({deviceId, revoked: true});
    process.stderr.write("note: if this was the current device session, run `atoa login` to re-authenticate.\n");
  })
});
