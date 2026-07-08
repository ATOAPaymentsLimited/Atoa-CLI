import {defineCommand} from "citty";
import {promises as fs} from "fs";
import {withCommonArgs, runWithSdkKey, type CommonOptions} from "../_common";
import {readStdin} from "../../lib/request-utils";
import {AtoaError} from "../../lib/errors";

type CreateArgs = CommonOptions & {
  url?: string;
  event?: string;
  authentication?: string;
};

export default defineCommand({
  meta: {name: "create", description: "Register a merchant webhook"},
  args: withCommonArgs({
    url: {type: "string", required: true, description: "HTTPS endpoint to receive events"},
    event: {
      type: "string",
      required: true,
      description: "event to subscribe to (e.g. PAYMENTS_STATUS, EXPIRED_STATUS, REFUND_STATUS)"
    },
    authentication: {
      type: "string",
      description:
        "optional auth config as JSON. Prefer @path/to/file.json or '-' (stdin) to keep secrets " +
        "out of shell history and ps output. Inline JSON also accepted. " +
        'OAuth 2.0: \'{"clientId":"...","clientSecret":"...","authUrl":"..."}\'. ' +
        'Basic: \'{"username":"...","password":"..."}\''
    }
  }),
  run: runWithSdkKey<CreateArgs>(async (ctx, args) => {
    let authentication: Record<string, unknown> | undefined;
    if (args.authentication) {
      const raw = await resolveAuthSource(args.authentication);
      try {
        authentication = JSON.parse(raw) as Record<string, unknown>;
      } catch (err) {
        throw new AtoaError(`--authentication must be valid JSON: ${(err as Error).message}`, "validation");
      }
    }

    const body = {
      url: args.url as string,
      event: args.event as string,
      ...(authentication && {authentication})
    };

    if (ctx.dryRun) {
      // Mirror the curl convention: print the resolved structure but DON'T
      // echo the raw secret values back. Caller already trusts what they
      // supplied; we still keep it out of stdout in case the dry-run output
      // is piped somewhere logged.
      ctx.print({
        method: "POST",
        path: "/api/webhook/merchant",
        body: authentication ? {...body, authentication: "<redacted>"} : body
      });
      return;
    }

    const {data} = await ctx.http.request({
      method: "POST",
      path: "/api/webhook/merchant",
      body,
      auth: "sdk"
    });
    ctx.print(data);
  })
});

/**
 * Resolves `--authentication` to a JSON string. Three forms (curl convention):
 *   - `@path/to/file.json` → reads from disk
 *   - `-`                  → reads from stdin
 *   - anything else        → treated as inline JSON
 *
 * The `@file` / stdin forms exist specifically so callers don't have to put
 * `clientSecret` / `password` on the command line, where it would land in
 * `ps aux`, shell history, and audit logs.
 */
async function resolveAuthSource(value: string): Promise<string> {
  if (value === "-") return await readStdin();
  if (value.startsWith("@")) {
    const path = value.slice(1);
    try {
      return await fs.readFile(path, "utf8");
    } catch (err) {
      throw new AtoaError(`--authentication @${path} could not be read: ${(err as Error).message}`, "validation");
    }
  }
  return value;
}
