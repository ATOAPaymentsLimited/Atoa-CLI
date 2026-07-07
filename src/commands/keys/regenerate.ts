import {defineCommand} from "citty";
import {confirm} from "@inquirer/prompts";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {AtoaError} from "../../lib/errors";
import {V1_ROUTES} from "../../lib/v1-routes";
import {saveSdkKey, latestSdkAccessId, findSdkKey} from "../../lib/sdk-key-file";

type RegenArgs = CommonOptions & {id?: string};

export default defineCommand({
  meta: {
    name: "regenerate",
    description:
      "Rotate an SDK key. The old token stops working immediately; the new apiSecret is written to ~/.atoa/auth/secret_key.json (path is printed)."
  },
  args: withCommonArgs({
    id: {
      type: "positional",
      required: false,
      description: "sdkAccessId to rotate (defaults to the most recently created key for the active env)"
    }
  }),
  run: runWithContext<RegenArgs>(async (ctx, args) => {
    const sdkAccessId = (args.id as string | undefined)?.trim() || (await latestSdkAccessId(ctx.env));
    if (!sdkAccessId) {
      throw new AtoaError("pass the sdkAccessId to rotate (see `atoa keys list`).", "validation");
    }
    // Keep the rotated key under its ORIGINAL env (from the stored record), not the context default —
    // otherwise rotating a sandbox key while the context is production would re-store it as production.
    const existing = await findSdkKey(sdkAccessId);
    const env = existing?.env ?? ctx.env;

    if (!ctx.yes) {
      const ok = await confirm({
        message: `Rotate SDK key "${sdkAccessId}"? The old token stops working immediately; the new one is written to the key file.`
      });
      if (!ok) {
        process.stdout.write("Aborted.\n");
        return;
      }
    }

    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.apiKeys.regenerate, pathParams: {keyId: sdkAccessId}, env});
      return;
    }

    let data: unknown;
    try {
      const res = await ctx.http.request({...V1_ROUTES.apiKeys.regenerate, pathParams: {keyId: sdkAccessId}});
      data = res.data;
    } catch (err) {
      if ((err as AtoaError).kind === "forbidden") {
        throw new AtoaError("Regenerating a key requires an admin role.", "forbidden", {
          status: (err as AtoaError).status,
          requestId: (err as AtoaError).requestId
        });
      }
      throw err;
    }

    const apiSecret = ((data ?? {}) as {apiSecret?: string}).apiSecret;
    if (!apiSecret) {
      throw new AtoaError("server response did not include a new apiSecret", "generic");
    }

    const savedTo = await saveSdkKey({
      env,
      sdkAccessId,
      apiSecret,
      profile: existing?.profile ?? ctx.profileName,
      createdAt: new Date().toISOString()
    });
    ctx.print({env, sdkAccessId, apiSecret, savedTo});
    process.stderr.write(`✓ rotated SDK key written to ${savedTo}\n`);
  })
});
