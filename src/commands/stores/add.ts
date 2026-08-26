import {defineCommand} from "citty";
import {FormData} from "undici";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {isInteractive} from "../../lib/output";
import {resolveField} from "../../lib/prompt-field";
import {STORE_FIELDS, normaliseStorePostcode} from "../../lib/validators";
import {resolveStoreToUpdate} from "./_shared";
import {t} from "../../lib/i18n";

type StoresAddArgs = CommonOptions & {
  locationName?: string;
  addressLine1?: string;
  addressLine2?: string;
  addressPostalCode?: string;
  cityOrTown?: string;
};

export default defineCommand({
  meta: {name: "add", description: t("cmdStoresAdd")},
  args: withCommonArgs({
    // Not `required: true` — on a TTY with a flag omitted we prompt for it instead of
    // hard-failing before that ever gets a chance (same reason as stores/update.ts's storeId).
    locationName: {type: "string", description: t("argStoreName")},
    addressLine1: {type: "string", description: t("argAddressLine1")},
    addressLine2: {type: "string", description: t("argAddressLine2")},
    addressPostalCode: {type: "string", description: t("argPostalCode")},
    cityOrTown: {type: "string", description: t("argCityOrTown")}
  }),
  run: runWithContext<StoresAddArgs>(async (ctx, args) => {
    const interactive = isInteractive(ctx.formatExplicit);

    // Ahead of the wizard, so a merchant with no bank account isn't asked for an address first.
    // A business still on its single DEFAULT location updates that one rather than gaining a second.
    // Runs under --dryRun too: it only reads, and skipping it printed a create for what would
    // have been an update — a preview that contradicts the run it is previewing.
    const storeToUpdate = await resolveStoreToUpdate(ctx);

    // Optional fields are only asked for as part of the wizard. A caller who supplied every
    // required flag has said what they wanted, so don't stop them for address line 2.
    const allRequiredGiven = Boolean(
      args.locationName?.trim() &&
        args.addressLine1?.trim() &&
        args.cityOrTown?.trim() &&
        args.addressPostalCode?.trim()
    );

    // Each field is validated against its rule, whether it
    // arrived by flag or by prompt; an invalid flag is re-asked rather than aborting the run.
    const locationName = await resolveField({
      value: args.locationName,
      flag: "location-name",
      message: t("labelLocationName"),
      rule: STORE_FIELDS.locationName,
      interactive
    });
    const addressLine1 = await resolveField({
      value: args.addressLine1,
      flag: "address-line1",
      message: t("labelAddressLine1"),
      rule: STORE_FIELDS.addressLine1,
      interactive
    });
    const addressLine2 = await resolveField({
      value: args.addressLine2,
      flag: "address-line2",
      message: t("labelAddressLine2Optional"),
      rule: STORE_FIELDS.addressLine2,
      interactive: interactive && !allRequiredGiven,
      optional: true
    });
    const cityOrTown = await resolveField({
      value: args.cityOrTown,
      flag: "city-or-town",
      message: t("labelTownCity"),
      rule: STORE_FIELDS.cityOrTown,
      interactive
    });
    const addressPostalCode = await resolveField({
      value: args.addressPostalCode,
      flag: "address-postal-code",
      message: t("labelPostCode"),
      rule: STORE_FIELDS.addressPostalCode,
      interactive
    });

    const fields: Record<string, string> = {
      locationName: locationName as string,
      addressLine1: addressLine1 as string,
      // Stripped: a stored postcode never contains a space.
      addressPostalCode: normaliseStorePostcode(addressPostalCode as string),
      cityOrTown: cityOrTown as string
    };
    if (addressLine2) fields.addressLine2 = addressLine2;
    // An id on the upsert makes it an update — this renames the DEFAULT location in place.
    if (storeToUpdate?.id) fields.id = storeToUpdate.id;

    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.stores.upsert, body: fields});
      return;
    }

    // Multipart, matching stores/image.ts — the backend's addOrUpdateStore handler
    // reads storeData via @BodyParams alongside an optional @MultipartFile("photo");
    // no photo here, this command is metadata-only (use `stores image` for that).
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);

    // A MULTI_STORE addon-limit rejection (ADDON_UPGRADE_REQUIRED) is classified and hinted
    // centrally in lib/errors.ts, so every addon-gated command reports it identically.
    const {data} = await ctx.http.request({...V1_ROUTES.stores.upsert, rawBody: form});
    const store = (data ?? {}) as {id?: string; locationName?: string};
    // Say so rather than reporting a create — the merchant still has one location, renamed.
    if (storeToUpdate) process.stderr.write(t("defaultStoreRenamed"));
    ctx.print({id: store.id, locationName: store.locationName});
  })
});
