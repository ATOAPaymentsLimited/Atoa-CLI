import {defineCommand} from "citty";
import {input} from "@inquirer/prompts";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {AtoaError} from "../../lib/errors";
import {V1_ROUTES} from "../../lib/v1-routes";
import {saveSdkKey} from "../../lib/sdk-key-file";

interface CreateKeyResponse {
  apiSecret?: string;
  sdkAccessId?: string;
}

type CreateArgs = CommonOptions & {name?: string};

export default defineCommand({
  meta: {
    name: "create",
    description: "Create a new SDK key. The apiSecret is written to ~/.atoa/auth/secret_key.json (path is printed)."
  },
  args: withCommonArgs({
    name: {type: "string", description: 'a label to recognise this key, e.g. "CI server" (prompted if omitted)'}
  }),
  run: runWithContext<CreateArgs>(async (ctx, args) => {
    const env = ctx.env;
    const tty = Boolean(process.stdin.isTTY);

    // The backend requires an "API Access name" — a human label for the key.
    const name = (
      args.name ?? (tty ? await input({message: 'Key name (a label to recognise this key, e.g. "CI server"):'}) : "")
    ).trim();
    if (!name) throw new AtoaError("an API key name is required — pass --name or run in a terminal", "validation");

    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.apiKeys.create, query: {env}, body: {name}});
      return;
    }

    let data: unknown;
    try {
      const res = await ctx.http.request({...V1_ROUTES.apiKeys.create, query: {env}, body: {name}});
      data = res.data;
    } catch (err) {
      if ((err as AtoaError).kind === "forbidden") {
        throw new AtoaError("Creating a key requires an admin role.", "forbidden", {
          status: (err as AtoaError).status,
          requestId: (err as AtoaError).requestId
        });
      }
      throw err; // surface KYB-gate and other backend errors as-is
    }

    const row = (data ?? {}) as CreateKeyResponse;
    const apiSecret = row.apiSecret;
    if (!apiSecret) {
      throw new AtoaError("server response did not include an apiSecret", "generic");
    }

    const savedTo = await saveSdkKey({
      env,
      sdkAccessId: row.sdkAccessId ?? null,
      apiSecret,
      profile: ctx.profileName,
      createdAt: new Date().toISOString()
    });

    ctx.print({
      name,
      env,
      sdkAccessId: row.sdkAccessId ?? null,
      apiSecret,
      savedTo
    });
    process.stderr.write(`✓ SDK key written to ${savedTo}\n`);
  })
});
