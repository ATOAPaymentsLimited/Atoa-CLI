import {defineCommand} from "citty";
import {confirm} from "@inquirer/prompts";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {AtoaError} from "../../lib/errors";
import {V1_ROUTES} from "../../lib/v1-routes";
import {removeSdkKey, latestSdkAccessId, findSdkKey} from "../../lib/sdk-key-file";
import {isInteractive} from "../../lib/output";

type RevokeArgs = CommonOptions & {id?: string};

export default defineCommand({
  meta: {
    name: "revoke",
    description: "Revoke an SDK key and remove it from ~/.atoa/auth/secret_key.json. Immediate and not recoverable."
  },
  args: withCommonArgs({
    id: {
      type: "positional",
      required: false,
      description: "sdkAccessId to revoke (defaults to the most recently created key for the active env)"
    }
  }),
  run: runWithContext<RevokeArgs>(async (ctx, args) => {
    const sdkAccessId = (args.id as string | undefined)?.trim() || (await latestSdkAccessId(ctx.env));
    if (!sdkAccessId) {
      throw new AtoaError("pass the sdkAccessId to revoke (see `atoa keys list`).", "validation");
    }
    // Report the key's OWN env (from its stored record), not the context default — a sandbox key
    // revoked while the context env is production must still read as "sandbox".
    const keyEnv = (await findSdkKey(sdkAccessId))?.env ?? ctx.env;

    if (!ctx.yes) {
      const ok = await confirm({message: `Revoke SDK key "${sdkAccessId}"? This is immediate and not recoverable.`});
      if (!ok) {
        process.stdout.write("Aborted.\n");
        return;
      }
    }

    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.apiKeys.delete, pathParams: {keyId: sdkAccessId}, env: keyEnv});
      return;
    }

    try {
      await ctx.http.request({...V1_ROUTES.apiKeys.delete, pathParams: {keyId: sdkAccessId}});
    } catch (err) {
      if ((err as AtoaError).kind === "forbidden") {
        throw new AtoaError("Revoking a key requires an admin role.", "forbidden", {
          status: (err as AtoaError).status,
          requestId: (err as AtoaError).requestId
        });
      }
      throw err;
    }

    await removeSdkKey(sdkAccessId);

    // Interactive terminal gets a one-line confirmation; scripting (piped / --output)
    // keeps the machine-readable object.
    if (isInteractive(ctx.formatExplicit)) {
      process.stdout.write(`✓ Revoked SDK key ${sdkAccessId} (${keyEnv})\n`);
    } else {
      ctx.print({env: keyEnv, sdkAccessId, revoked: true});
    }
  })
});
