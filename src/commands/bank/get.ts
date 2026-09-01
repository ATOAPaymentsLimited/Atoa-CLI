import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {AtoaError} from "../../lib/errors";
import {projectBankAccount, type BankAccountRow} from "./_shared";

type BankGetArgs = CommonOptions & {id: string};

export default defineCommand({
  meta: {name: "get", description: "Get a bank account by id"},
  args: withCommonArgs({
    id: {type: "positional", required: true, description: "bank account id"}
  }),
  run: runWithContext<BankGetArgs>(async (ctx, args) => {
    const id = args.id?.trim();
    if (!id) throw new AtoaError("bank account id is required", "validation");

    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.bank.get, pathParams: {id}});
      return;
    }
    const {data} = await ctx.http.request({...V1_ROUTES.bank.get, pathParams: {id}});
    ctx.print(projectBankAccount(data as BankAccountRow));
  })
});
