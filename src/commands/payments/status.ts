import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import type {CommandContext} from "../../lib/context";
import {AtoaError} from "../../lib/errors";

type StatusArgs = CommonOptions & {id?: string; poll?: boolean};

const MAX_POLL_MS = 3 * 60 * 1000;

async function poll(ctx: CommandContext, path: string, query: Record<string, string>): Promise<void> {
  const start = Date.now();
  let wait = 5_000;
  let lastRequestId: string | undefined;
  while (Date.now() - start < MAX_POLL_MS) {
    const {data, requestId} = await ctx.http.request({method: "GET", path, query});
    lastRequestId = requestId;
    const status = (data as Record<string, unknown>)?.status;
    if (ctx.verbose) process.stderr.write(`polling: status=${status}\n`);
    if (status && status !== "PENDING") {
      ctx.print(data);
      return;
    }
    await new Promise((r) => setTimeout(r, wait));
    wait = Math.min(wait * 1.5, 30_000);
  }
  throw new AtoaError("timed out polling payment status after 3 minutes", "generic", {requestId: lastRequestId});
}

export default defineCommand({
  meta: {
    name: "status",
    description: "Get the current status of a payment request, scoped to the active environment"
  },
  args: withCommonArgs({
    id: {type: "positional", required: true, description: "payment request ID"},
    poll: {type: "boolean", description: "poll every 5 s until non-PENDING (max 3 min)"}
  }),
  run: runWithContext<StatusArgs>(async (ctx, args) => {
    const path = `/api/payments/v1/payment-status/${encodeURIComponent(args.id as string)}`;
    const query: Record<string, string> = {env: ctx.env};

    if (ctx.dryRun) {
      ctx.print({method: "GET", path, query});
      return;
    }

    if (args.poll) {
      await poll(ctx, path, query);
    } else {
      const {data} = await ctx.http.request({method: "GET", path, query});
      ctx.print(data);
    }
  })
});
