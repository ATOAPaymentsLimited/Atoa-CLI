import {defineCommand} from "citty";
import {confirm} from "@inquirer/prompts";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {AtoaError} from "../../lib/errors";
import {isInteractive} from "../../lib/output";

type BankDeleteArgs = CommonOptions & {id: string};

export default defineCommand({
  meta: {name: "delete", description: "Delete a bank account from the active business"},
  args: withCommonArgs({
    id: {type: "positional", required: true, description: "bank account id"}
  }),
  run: runWithContext<BankDeleteArgs>(async (ctx, args) => {
    const id = args.id?.trim();
    if (!id) throw new AtoaError("bank account id is required", "validation");

    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.bank.delete, pathParams: {id}});
      return;
    }

    if (!args.yes) {
      if (!process.stdin.isTTY) {
        throw new AtoaError(
          "Deleting a bank account is destructive — pass --yes to confirm in a non-interactive shell.",
          "validation"
        );
      }
      const ok = await confirm({message: `Delete bank account ${id}? This cannot be undone.`, default: false});
      if (!ok) {
        process.stderr.write("Aborted.\n");
        return;
      }
    }

    await ctx.http.request({...V1_ROUTES.bank.delete, pathParams: {id}});
    if (isInteractive(ctx.formatExplicit)) {
      process.stdout.write(`✓ Deleted bank account ${id}\n`);
    } else {
      ctx.print({status: "deleted", id});
    }
  })
});
