import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "./_common";

type PostArgs = CommonOptions & {path?: string; data?: string; idempotencyKey?: string};
import {parseFieldArgs, resolvePathAndQuery, resolveBody} from "../lib/request-utils";

export default defineCommand({
  meta: {name: "post", description: "Send a POST request  (-d key=val builds body; --data @file|-  for raw JSON)"},
  args: withCommonArgs({
    path: {type: "positional", required: true, description: "/api/path/:param"},
    data: {type: "string", description: "@filepath or - (stdin) for raw JSON body"},
    idempotencyKey: {
      type: "string",
      description: "override the auto-generated Idempotency-Key (e.g. CI dedup keyed off $RUN_ID)"
    }
  }),
  run: runWithContext<PostArgs>(async (ctx, args, rawArgs) => {
    const fields = parseFieldArgs(rawArgs);
    const body = await resolveBody(args.data, fields);
    const {resolvedPath, query} = resolvePathAndQuery(args.path as string, {});

    if (ctx.dryRun) {
      ctx.print({
        method: "POST",
        url: ctx.http.baseUrl + resolvedPath,
        query,
        body,
        idempotencyKey: args.idempotencyKey ?? "(auto-generated UUIDv4)"
      });
      return;
    }

    const {data} = await ctx.http.request({
      method: "POST",
      path: resolvedPath,
      query,
      body,
      idempotencyKey: args.idempotencyKey,
      auth: "jwt"
    });
    ctx.print(data);
  })
});
