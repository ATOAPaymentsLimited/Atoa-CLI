import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import type {CommandContext} from "../../lib/context";
import {V1_ROUTES} from "../../lib/v1-routes";
import {AtoaError} from "../../lib/errors";
import {isInteractive} from "../../lib/output";
import {t} from "../../lib/i18n";
import {projectPlace, placeLabel, type GooglePlace} from "./_shared";

type LinkArgs = CommonOptions & {store?: string; placeId?: string; search?: string};

/** Sentinels, so a real place_id can never collide with an action. */
const SEARCH_AGAIN = "__search_again__";
const CANCEL = "__cancel__";
const MAX_SEARCHES = 5;

// A text search can return twenty listings. Showing them all pushes Cancel off the visible page,
// and with the list looping it reappears part-way up the results, reading as one of them. Eight
// plus the two actions fits a page whole, so nothing scrolls and the way out is always on screen.
const MAX_RESULTS = 8;

interface StoreRow {
  id?: string;
  locationName?: string;
  addressPostalCode?: string;
}

export default defineCommand({
  meta: {name: "link", description: t("cmdGoogleLink")},
  args: withCommonArgs({
    store: {type: "string", description: t("argGoogleStore")},
    placeId: {type: "string", description: t("argGooglePlaceId")},
    search: {type: "string", description: t("argGoogleSearch")}
  }),
  run: runWithContext<LinkArgs>(async (ctx, args) => {
    const interactive = isInteractive(ctx.formatExplicit);

    const store = await resolveStore(ctx, args.store?.trim(), interactive);
    const place = await resolvePlace(ctx, args, interactive);

    // The listing's own name and address are sent alongside the id so the review service can show
    // what was linked without re-querying Google for every render.
    const body = {
      merchantStoreId: store.id,
      placeId: place.place_id,
      businessName: place.name ?? "",
      businessAddress: place.formatted_address ?? "",
      storePostalCode: store.addressPostalCode ?? ""
    };

    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.google.linkLocation, body});
      return;
    }

    if (interactive && !ctx.yes) {
      const {confirm} = await import("@inquirer/prompts");
      const ok = await confirm({
        message: t("googleLinkConfirm", {store: store.locationName ?? store.id ?? "", place: placeLabel(place)}),
        default: true
      });
      if (!ok) {
        process.stderr.write(t("aborted"));
        return;
      }
    }

    const {data} = await ctx.http.request({...V1_ROUTES.google.linkLocation, body});
    ctx.print(data ?? {status: "linked", store: store.id, placeId: place.place_id});
  })
});

/** The Atoa store to attach the listing to. */
async function resolveStore(ctx: CommandContext, flag: string | undefined, interactive: boolean): Promise<StoreRow> {
  const {data} = await ctx.http.request({...V1_ROUTES.stores.list});
  const stores = (Array.isArray(data) ? data : ((data as {data?: unknown})?.data ?? [])) as StoreRow[];
  if (!stores.length) throw new AtoaError(t("noStoresFound"), "not_found");

  if (flag) {
    const hit = stores.find((s) => s.id === flag);
    if (!hit) {
      throw new AtoaError(
        t("googleStoreNotFound", {options: stores.map((s) => s.locationName).join(", ")}),
        "validation"
      );
    }
    return hit;
  }
  if (!interactive) {
    throw new AtoaError(
      t("flagRequiredWithOptions", {
        flag: "store",
        options: stores.map((s) => `${s.locationName} (${s.id})`).join(", ")
      }),
      "validation"
    );
  }

  const {select} = await import("@inquirer/prompts");
  const id = await select<string>({
    message: t("googlePickStore"),
    pageSize: 12,
    loop: false,
    choices: stores.map((s) => ({name: `${s.locationName ?? "(unnamed)"} (${s.id})`, value: s.id ?? ""}))
  });
  return stores.find((s) => s.id === id) as StoreRow;
}

async function searchPlaces(ctx: CommandContext, text: string): Promise<GooglePlace[]> {
  const {data} = await ctx.http.request({...V1_ROUTES.google.searchLocations, query: {text}});
  return (Array.isArray(data) ? data : []) as GooglePlace[];
}

/**
 * The Google listing. A --place-id still has to be resolved back to a full record: the name and
 * address are stored as given and never re-derived from the id, and a second link replaces the
 * stored metadata rather than merging, so linking on a bare id would blank a listing that was
 * previously correct. Interactively, searching can be repeated without leaving the command — the
 * first attempt rarely names the right branch of a chain.
 */
async function resolvePlace(ctx: CommandContext, args: LinkArgs, interactive: boolean): Promise<GooglePlace> {
  const placeId = args.placeId?.trim();
  const search = args.search?.trim();

  if (placeId) {
    if (!search) throw new AtoaError(t("googleSearchRequiredWithPlaceId"), "validation");
    const hit = (await searchPlaces(ctx, search)).find((p) => p.place_id === placeId);
    if (!hit) throw new AtoaError(t("googlePlaceIdNotInSearch", {placeId, term: search}), "validation");
    return hit;
  }

  if (!interactive) {
    throw new AtoaError(t("googlePlaceIdRequired"), "validation");
  }

  const {input, select, Separator} = await import("@inquirer/prompts");
  let term = search;

  // Bounded rather than open-ended: refining the term a few times is normal, but a loop with no
  // ceiling and no visible way out leaves Ctrl-C as the only exit. Cancel is an explicit choice,
  // and the rounds are capped so the command always terminates on its own.
  for (let round = 1; round <= MAX_SEARCHES; round++) {
    if (!term) term = (await input({message: t("googleSearchPrompt")})).trim();
    if (!term) continue;

    const places = await searchPlaces(ctx, term);

    if (!places.length) {
      process.stderr.write(t("googleNoMatches", {term}));
      term = undefined;
      continue;
    }

    const shown = places.slice(0, MAX_RESULTS);
    const message =
      places.length > shown.length
        ? t("googlePickPlaceTruncated", {term, round, max: MAX_SEARCHES, shown: shown.length, total: places.length})
        : t("googlePickPlace", {term, round, max: MAX_SEARCHES});

    // The two escape routes sit below a rule, so they read as actions rather than as more results.
    const chosen = await select<string>({
      message,
      pageSize: 12,
      loop: false,
      choices: [
        ...shown.map((p) => ({name: placeLabel(p), value: p.place_id ?? ""})),
        new Separator(),
        {name: t("googleSearchAgain"), value: SEARCH_AGAIN},
        {name: t("googleCancel"), value: CANCEL}
      ]
    });

    if (chosen === CANCEL) throw new AtoaError(t("googleLinkCancelled"), "validation");
    if (chosen === SEARCH_AGAIN) {
      term = undefined;
      continue;
    }
    return places.find((p) => p.place_id === chosen) as GooglePlace;
  }

  throw new AtoaError(t("googleSearchGaveUp", {max: MAX_SEARCHES}), "validation");
}

export {projectPlace};
