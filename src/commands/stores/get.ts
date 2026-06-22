import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {AtoaError} from "../../lib/errors";

type StoresGetArgs = CommonOptions & {storeId: string};

export default defineCommand({
  meta: {name: "get", description: "Get a merchant store by ID"},
  args: withCommonArgs({
    storeId: {type: "positional", required: true, description: "store ID"}
  }),
  run: runWithContext<StoresGetArgs>(async (ctx, args) => {
    const storeId = args.storeId?.trim();
    if (!storeId) throw new AtoaError("storeId is required", "validation");

    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.stores.get, pathParams: {storeId}});
      return;
    }
    const {data} = await ctx.http.request({...V1_ROUTES.stores.get, pathParams: {storeId}});

    // Response is a MerchantStoreEntity (was the old curated StoreResponse). Project
    // the core fields by their entity names; relation arrays are omitted from the
    // display. Read defensively since the entity shape is untyped here.
    const store = (data ?? {}) as MerchantStoreEntity;
    ctx.print({
      id: store.id,
      locationName: store.locationName,
      addressLine1: store.addressLine1,
      addressLine2: store.addressLine2,
      addressPostalCode: store.addressPostalCode,
      cityOrTown: store.cityOrTown,
      primary: store.primary,
      enabled: store.enabled,
      bankAccount: store.bankAccount
    });
  })
});

/** Subset of the backend MerchantStoreEntity this command surfaces. */
interface MerchantStoreEntity {
  id?: string;
  locationName?: string;
  addressLine1?: string;
  addressLine2?: string;
  addressPostalCode?: string;
  cityOrTown?: string;
  primary?: boolean;
  enabled?: boolean;
  bankAccount?: unknown;
}
