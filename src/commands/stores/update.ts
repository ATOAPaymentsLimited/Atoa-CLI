import {defineCommand} from "citty";
import {FormData} from "undici";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {fetchAllPages, STORES_PAGE_SIZE} from "../../lib/list-view";
import {isInteractive} from "../../lib/output";
import {AtoaError} from "../../lib/errors";
import {resolveField} from "../../lib/prompt-field";
import {STORE_FIELDS, normaliseStorePostcode} from "../../lib/validators";
import t from "../../locales/en.json";
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
    const interactive = isInteractive(ctx.formatExplicit);
    let storeId = args.storeId?.trim();

    if (!storeId) {
      if (!interactive) {
        throw new AtoaError("storeId is required (non-interactive)", "validation");
      }
      storeId = await pickStoreId(ctx);
    }

    // Prefill from the current store so flags the caller omitted keep their existing value.
    const {data: current} = await ctx.http.request({...V1_ROUTES.stores.get, pathParams: {storeId}});
    const existing = (current ?? {}) as StoreFields;

    // On a TTY every field is offered with its current value as the editable default, so
    // `stores update <id>` with no flags walks the whole record instead of silently no-op'ing.
    // Values are validated against the same rules `stores add` uses.
    const resolve = (key: keyof typeof STORE_FIELDS, flag: string, message: string, optional = false) =>
      resolveField({
        // Off a TTY an omitted flag keeps the store's current value — an update must not blank
        // fields the caller never mentioned. On a TTY it is left empty so the field is offered
        // for editing, with the current value as the default.
        value: interactive ? args[key] : (args[key] ?? existing[key]),
        flag,
        message,
        rule: STORE_FIELDS[key],
        interactive,
        optional,
        default: existing[key]
      });

    const locationName = await resolve("locationName", "location-name", t.labelLocationName);
    const addressLine1 = await resolve("addressLine1", "address-line1", t.labelAddressLine1);
    const addressLine2 = await resolve("addressLine2", "address-line2", t.labelAddressLine2Optional, true);
    const cityOrTown = await resolve("cityOrTown", "city-or-town", t.labelTownCity);
    const addressPostalCode = await resolve("addressPostalCode", "address-postal-code", t.labelPostCode);

    const fields: Record<string, string> = {
      id: storeId,
      locationName: locationName ?? "",
      addressLine1: addressLine1 ?? "",
      addressPostalCode: normaliseStorePostcode(addressPostalCode ?? ""),
      cityOrTown: cityOrTown ?? ""
    };
    if (addressLine2) fields.addressLine2 = addressLine2;

    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.stores.upsert, body: fields});
      return;
    }

    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);

    // ADDON_UPGRADE_REQUIRED is classified and hinted centrally in lib/errors.ts.
    const {data} = await ctx.http.request({...V1_ROUTES.stores.upsert, rawBody: form});
    const store = (data ?? {}) as StoreFields;
    ctx.print({id: store.id, locationName: store.locationName});
  })
});

/** TTY-only: list stores and let the user pick one, returning its id. */
async function pickStoreId(ctx: CommandContext): Promise<string> {
  const rows = (await fetchAllPages(ctx, V1_ROUTES.stores.list, {}, STORES_PAGE_SIZE)) as StoreFields[];
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
