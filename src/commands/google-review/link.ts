import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {fetchAllPages} from "../../lib/list-view";
import {isInteractive} from "../../lib/output";
import {AtoaError} from "../../lib/errors";
import {openBrowser} from "../../lib/browser";
import {resolveBaseUrl} from "../../lib/env";
import {getActiveBusinessId} from "../../lib/config-store";
import type {CommandContext} from "../../lib/context";

type GoogleReviewLinkArgs = CommonOptions & {
  /** Headless fallback: search Google locations by place text instead of the OAuth flow. */
  place?: string;
};

interface AccountRow {
  id?: string;
  accountName?: string;
  type?: string;
}
interface LocationRow {
  platformLocationId?: string;
  name?: string;
  title?: string;
}
interface StoreRow {
  id?: string;
  locationName?: string;
}
interface GoogleSearchRow {
  name?: string;
  formatted_address?: string;
  place_id?: string;
}

export default defineCommand({
  meta: {
    name: "link",
    description: "Connect this business's Google Business Profile for review collection (OAuth handoff on a TTY)"
  },
  args: withCommonArgs({
    place: {
      type: "string",
      description: 'headless fallback: search Google locations by place text, e.g. --place "Acme Cafe London"'
    }
  }),
  run: runWithContext<GoogleReviewLinkArgs>(async (ctx, args) => {
    const placeText = args.place?.trim();
    if (placeText) {
      await linkByPlaceSearch(ctx, placeText);
      return;
    }
    if (!isInteractive(ctx.formatExplicit)) {
      throw new AtoaError(
        'the OAuth handoff needs a TTY — pass --place "<search text>" for a headless link instead',
        "validation"
      );
    }
    await linkViaOAuth(ctx);
  })
});

/** Interactive path: open the OAuth redirect, then pick an account and a location per store. */
async function linkViaOAuth(ctx: CommandContext): Promise<void> {
  const businessId = await getActiveBusinessId(ctx.profileName);
  if (!businessId) {
    throw new AtoaError(`no active business for profile "${ctx.profileName}". Re-pair via 'atoa login'.`, "validation");
  }

  const state = Buffer.from(JSON.stringify({merchantId: businessId, isAppLayout: false})).toString("base64");
  const url = new URL("/api/merchant/google-review/redirect", resolveBaseUrl());
  url.searchParams.set("state", state);

  if (ctx.dryRun) {
    ctx.print({url: url.toString()});
    return;
  }

  // Browser hand-off only for the OAuth step itself — everything after (account
  // and location selection) is plain API calls, same as the rest of this CLI.
  await openBrowser(url.toString());
  const {confirm, select} = await import("@inquirer/prompts");
  const done = await confirm({message: "Finish signing in to Google in the browser, then confirm here", default: true});
  if (!done) return;

  const {data: accountsData} = await ctx.http.request({...V1_ROUTES.googleReview.accounts});
  const accounts = (accountsData ?? []) as AccountRow[];
  if (accounts.length === 0)
    throw new AtoaError("no Google Business accounts found — was sign-in completed?", "not_found");

  const account = await select<AccountRow>({
    message: "Select a Google Business account",
    choices: accounts.map((a) => ({name: `${a.accountName ?? "(unnamed)"} (${a.type ?? ""})`, value: a}))
  });

  await ctx.http.request({
    ...V1_ROUTES.googleReview.linkAccount,
    body: {platform: "Google", platformBusinessId: account.id}
  });
  await linkStoreLocations(ctx, account, select);
  ctx.print({linked: account.accountName});
}

/** Walks every store, offering the connected account's Google locations (or a skip option). */
async function linkStoreLocations(
  ctx: CommandContext,
  account: AccountRow,
  select: <T>(config: {message: string; choices: Array<{name: string; value: T}>}) => Promise<T>
): Promise<void> {
  const {data: locationsData} = await ctx.http.request({
    ...V1_ROUTES.googleReview.accountLocations,
    pathParams: {businessAccountId: account.id ?? ""}
  });
  const locations = (locationsData ?? []) as LocationRow[];
  if (locations.length === 0) return;

  const stores = (await fetchAllPages(ctx, V1_ROUTES.stores.list)) as StoreRow[];
  for (const store of stores) {
    const location = await select<LocationRow>({
      message: `Select the Google location for "${store.locationName ?? store.id}" (or skip)`,
      choices: [
        {name: "— Skip this store —", value: {} as LocationRow},
        ...locations.map((l) => ({name: l.title ?? l.name ?? l.platformLocationId ?? "(unnamed)", value: l}))
      ]
    });
    if (!location.platformLocationId) continue;
    await ctx.http.request({
      ...V1_ROUTES.googleReview.linkLocation,
      body: {merchantStoreId: store.id, platformLocationId: location.platformLocationId}
    });
  }
}

/** No-browser path: search by place text and link straight to a chosen store, skipping OAuth entirely. */
async function linkByPlaceSearch(ctx: CommandContext, placeText: string): Promise<void> {
  const {data} = await ctx.http.request({...V1_ROUTES.googleReview.searchLocations, query: {text: placeText}});
  const results = (data ?? []) as GoogleSearchRow[];
  if (results.length === 0) throw new AtoaError(`no Google locations found matching "${placeText}"`, "not_found");

  const {select} = await import("@inquirer/prompts");
  const picked = await select<GoogleSearchRow>({
    message: "Select a location",
    choices: results.map((r) => ({name: `${r.name ?? "(unnamed)"} — ${r.formatted_address ?? ""}`, value: r}))
  });

  const stores = (await fetchAllPages(ctx, V1_ROUTES.stores.list)) as StoreRow[];
  if (stores.length === 0) throw new AtoaError("no stores found for this business", "not_found");
  const store = await select<StoreRow>({
    message: "Link to which store?",
    choices: stores.map((s) => ({name: s.locationName ?? s.id ?? "(unnamed)", value: s}))
  });

  await ctx.http.request({
    ...V1_ROUTES.googleReview.linkLocation,
    body: {
      merchantStoreId: store.id,
      placeId: picked.place_id,
      businessName: picked.name,
      businessAddress: picked.formatted_address
    }
  });
  ctx.print({linked: picked.name});
}
