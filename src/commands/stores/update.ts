import {defineCommand} from "citty";
import {FormData} from "undici";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {fetchAllPages} from "../../lib/list-view";
import {isInteractive} from "../../lib/output";
import {AtoaError} from "../../lib/errors";
import type {CommandContext} from "../../lib/context";

type StoresUpdateArgs = CommonOptions & {
  storeId?: string;
  locationName?: string;
  addressLine1?: string;
  addressLine2?: string;
  addressPostalCode?: string;
  cityOrTown?: string;
};

interface StoreFields {
  id?: string;
  locationName?: string;
  addressLine1?: string;
  addressLine2?: string;
  addressPostalCode?: string;
  cityOrTown?: string;
}

export default defineCommand({
  meta: {name: "update", description: "Update an existing merchant store"},
  args: withCommonArgs({
    storeId: {type: "positional", required: false, description: "store ID (omit to pick from the store list on a TTY)"},
    locationName: {type: "string", description: "store name"},
    addressLine1: {type: "string", description: "address line 1"},
    addressLine2: {type: "string", description: "address line 2"},
    addressPostalCode: {type: "string", description: "postal code"},
    cityOrTown: {type: "string", description: "city or town"}
  }),
  run: runWithContext<StoresUpdateArgs>(async (ctx, args) => {
    let storeId = args.storeId?.trim();

    if (!storeId) {
      if (!isInteractive(ctx.formatExplicit)) {
        throw new AtoaError("storeId is required (non-interactive)", "validation");
      }
      storeId = await pickStoreId(ctx);
    }

    // Prefill from the current store so flags the caller omitted keep their existing value.
    const {data: current} = await ctx.http.request({...V1_ROUTES.stores.get, pathParams: {storeId}});
    const existing = (current ?? {}) as StoreFields;

    const fields: Record<string, string> = {
      id: storeId,
      locationName: args.locationName?.trim() || existing.locationName || "",
      addressLine1: args.addressLine1?.trim() || existing.addressLine1 || "",
      addressPostalCode: args.addressPostalCode?.trim() || existing.addressPostalCode || "",
      cityOrTown: args.cityOrTown?.trim() || existing.cityOrTown || ""
    };
    const addressLine2 = args.addressLine2?.trim() ?? existing.addressLine2;
    if (addressLine2) fields.addressLine2 = addressLine2;

    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.stores.upsert, body: fields});
      return;
    }

    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);

    try {
      const {data} = await ctx.http.request({...V1_ROUTES.stores.upsert, rawBody: form});
      const store = (data ?? {}) as StoreFields;
      ctx.print({id: store.id, locationName: store.locationName});
    } catch (err) {
      throw withUpgradeHint(err);
    }
  })
});

/** TTY-only: list stores and let the user pick one, returning its id. */
async function pickStoreId(ctx: CommandContext): Promise<string> {
  const rows = (await fetchAllPages(ctx, V1_ROUTES.stores.list)) as StoreFields[];
  if (rows.length === 0) throw new AtoaError("no stores found for this business", "not_found");

  const {select} = await import("@inquirer/prompts");
  const storeId = await select<string>({
    message: "Select a store to update",
    pageSize: 12,
    choices: rows.map((s) => ({
      name: `${s.locationName ?? "(unnamed)"} — ${s.addressPostalCode ?? ""}`,
      value: s.id ?? ""
    }))
  });
  if (!storeId) throw new AtoaError("no store selected", "validation");
  return storeId;
}

/** MULTI_STORE addon-limit hit — see stores/add.ts for the same handling. */
function withUpgradeHint(err: unknown): unknown {
  if (err instanceof AtoaError && err.errorCode === "ADDON_UPGRADE_REQUIRED") {
    return new AtoaError(`${err.message} — run 'atoa addons list' to see plan/store limits`, err.kind, {
      status: err.status,
      errorCode: err.errorCode,
      requestId: err.requestId,
      additionalData: err.additionalData
    });
  }
  return err;
}
