import {defineCommand} from "citty";
import {FormData} from "undici";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {isInteractive} from "../../lib/output";
import {AtoaError} from "../../lib/errors";

type StoresAddArgs = CommonOptions & {
  locationName?: string;
  addressLine1?: string;
  addressLine2?: string;
  addressPostalCode?: string;
  cityOrTown?: string;
};

const required = (value: string) => (value.trim() ? true : "required");

export default defineCommand({
  meta: {name: "add", description: "Create a new merchant store"},
  args: withCommonArgs({
    // Not `required: true` — on a TTY with a flag omitted we prompt for it instead of
    // hard-failing before that ever gets a chance (same reason as stores/update.ts's storeId).
    locationName: {type: "string", description: "store name"},
    addressLine1: {type: "string", description: "address line 1"},
    addressLine2: {type: "string", description: "address line 2"},
    addressPostalCode: {type: "string", description: "postal code"},
    cityOrTown: {type: "string", description: "city or town"}
  }),
  run: runWithContext<StoresAddArgs>(async (ctx, args) => {
    let locationName = args.locationName?.trim();
    let addressLine1 = args.addressLine1?.trim();
    let addressLine2 = args.addressLine2?.trim();
    let addressPostalCode = args.addressPostalCode?.trim();
    let cityOrTown = args.cityOrTown?.trim();

    if (!locationName || !addressLine1 || !addressPostalCode || !cityOrTown) {
      if (!isInteractive(ctx.formatExplicit)) {
        if (!locationName) throw new AtoaError("--location-name is required (non-interactive)", "validation");
        if (!addressLine1) throw new AtoaError("--address-line1 is required (non-interactive)", "validation");
        if (!addressPostalCode)
          throw new AtoaError("--address-postal-code is required (non-interactive)", "validation");
        if (!cityOrTown) throw new AtoaError("--city-or-town is required (non-interactive)", "validation");
      } else {
        const {input} = await import("@inquirer/prompts");
        if (!locationName) locationName = (await input({message: "Store name:", validate: required})).trim();
        if (!addressLine1) addressLine1 = (await input({message: "Address line 1:", validate: required})).trim();
        if (args.addressLine2 === undefined) {
          addressLine2 = (await input({message: "Address line 2 (optional):"})).trim() || undefined;
        }
        if (!cityOrTown) cityOrTown = (await input({message: "City or town:", validate: required})).trim();
        if (!addressPostalCode) {
          addressPostalCode = (await input({message: "Postal code:", validate: required})).trim();
        }
      }
    }

    // Every branch above either throws or fills these in, but that's not something
    // TypeScript's narrowing can see through an `||`-guarded if/else — assert here.
    const fields: Record<string, string> = {
      locationName: locationName as string,
      addressLine1: addressLine1 as string,
      addressPostalCode: addressPostalCode as string,
      cityOrTown: cityOrTown as string
    };
    if (addressLine2) fields.addressLine2 = addressLine2;

    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.stores.upsert, body: fields});
      return;
    }

    // Multipart, matching stores/image.ts — the backend's addOrUpdateStore handler
    // reads storeData via @BodyParams alongside an optional @MultipartFile("photo");
    // no photo here, this command is metadata-only (use `stores image` for that).
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);

    try {
      const {data} = await ctx.http.request({...V1_ROUTES.stores.upsert, rawBody: form});
      const store = (data ?? {}) as {id?: string; locationName?: string};
      ctx.print({id: store.id, locationName: store.locationName});
    } catch (err) {
      throw withUpgradeHint(err);
    }
  })
});

/**
 * MULTI_STORE addon-limit hit: the backend rejects with errorCode
 * ADDON_UPGRADE_REQUIRED. Surface a clean message with an upgrade hint instead of
 * letting the raw backend message stand alone.
 */
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
