import {defineCommand} from "citty";
import {confirm} from "@inquirer/prompts";
import {withCommonArgs, runWithSdkKey, type CommonOptions} from "../_common";

type DeleteArgs = CommonOptions & {id?: string; customer?: string};

export default defineCommand({
  meta: {name: "delete", description: "Delete a payment method (prompts unless --yes)"},
  args: withCommonArgs({
    id: {type: "positional", required: true, description: "card ID"},
    customer: {type: "string", required: true, description: "customer ID"}
  }),
  run: runWithSdkKey<DeleteArgs>(async (ctx, args) => {
    const id = args.id as string;
    const customer = args.customer as string;
    const path = `/api/customers/${encodeURIComponent(customer)}/cards/${encodeURIComponent(id)}`;

    if (ctx.dryRun) {
      ctx.print({method: "DELETE", path});
      return;
    }

    if (!ctx.yes) {
      const ok = await confirm({
        message: `Delete payment method ${id} for customer ${customer}? This cannot be undone.`
      });
      if (!ok) {
        process.stdout.write("Aborted.\n");
        return;
      }
    }

    const {data} = await ctx.http.request({method: "DELETE", path});
    ctx.print(data);
  })
});
