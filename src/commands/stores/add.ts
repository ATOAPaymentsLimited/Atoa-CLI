import {defineCommand} from "citty";
import {FormData} from "undici";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {isInteractive} from "../../lib/output";
import {resolveField} from "../../lib/prompt-field";
import {STORE_FIELDS, normaliseStorePostcode} from "../../lib/validators";
import {t} from "../../lib/i18n";

type StoresAddArgs = CommonOptions & {
  locationName?: string;
  addressLine1?: string;
  addressLine2?: string;
  addressPostalCode?: string;
  cityOrTown?: string;
};

export default defineCommand({
  meta: {name: "add", description: "Add a new merchant store"},
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
    const interactive = isInteractive(ctx.formatExplicit);

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
    ctx.print({id: store.id, locationName: store.locationName});
  })
});
