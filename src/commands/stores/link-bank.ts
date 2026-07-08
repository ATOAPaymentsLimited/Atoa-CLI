import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {AtoaError} from "../../lib/errors";

type StoresLinkBankArgs = CommonOptions & {storeId: string; bank: string};

export default defineCommand({
  meta: {name: "link-bank", description: "Link a bank account to a store"},
  args: withCommonArgs({
    storeId: {type: "positional", required: true, description: "store ID"},
    bank: {type: "string", required: true, description: "bank account ID to link"}
  }),
  run: runWithContext<StoresLinkBankArgs>(async (ctx, args) => {
    const storeId = args.storeId?.trim();
    const bankAccountId = args.bank?.trim();
    if (!storeId) throw new AtoaError("storeId is required", "validation");
    if (!bankAccountId) throw new AtoaError("--bank is required", "validation");

    const body = {bankAccountId};

    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.stores.linkBank, pathParams: {storeId}, body});
      return;
    }
    const {data} = await ctx.http.request({...V1_ROUTES.stores.linkBank, pathParams: {storeId}, body});
    ctx.print(data);
  })
});
