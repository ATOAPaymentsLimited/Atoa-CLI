import {defineCommand} from "citty";
import {confirm} from "@inquirer/prompts";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {AtoaError} from "../../lib/errors";
import {isInteractive} from "../../lib/output";

type PaymentLinksDeleteArgs = CommonOptions & {id: string; storeId: string};

export default defineCommand({
  meta: {name: "delete", description: "Delete a payment link"},
  args: withCommonArgs({
    id: {type: "positional", required: true, description: "payment link id"},
    storeId: {type: "string", required: true, description: "store ID the link belongs to"}
  }),
  run: runWithContext<PaymentLinksDeleteArgs>(async (ctx, args) => {
    const id = args.id?.trim();
    if (!id) throw new AtoaError("payment link id is required", "validation");
    const storeId = args.storeId?.trim();
    if (!storeId) throw new AtoaError("--store-id is required", "validation");

    // businessId is auto-filled from the active profile; storeId + linkId are carried in the path.
    const route = {...V1_ROUTES.payments.links.delete, pathParams: {storeId, linkId: id}};

    if (ctx.dryRun) {
      ctx.print(route);
      return;
    }

    if (!args.yes) {
      if (!process.stdin.isTTY) {
        throw new AtoaError(
          "Deleting a payment link is destructive — pass --yes to confirm in a non-interactive shell.",
          "validation"
        );
      }
      const ok = await confirm({message: `Delete payment link ${id}? This cannot be undone.`, default: false});
      if (!ok) {
        process.stderr.write("Aborted.\n");
        return;
      }
    }

    await ctx.http.request(route);
    if (isInteractive(ctx.formatExplicit)) {
      process.stdout.write(`✓ Deleted payment link ${id}\n`);
    } else {
      ctx.print({status: "deleted", id});
    }
  })
});
