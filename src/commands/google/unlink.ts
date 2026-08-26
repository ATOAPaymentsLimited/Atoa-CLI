import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import type {CommandContext} from "../../lib/context";
import {V1_ROUTES} from "../../lib/v1-routes";
import {AtoaError} from "../../lib/errors";
import {isInteractive} from "../../lib/output";
import {t} from "../../lib/i18n";

type UnlinkArgs = CommonOptions & {store?: string};

interface LinkedRow {
  merchantStoreId?: string;
  metaData?: {metadata?: {title?: string; address?: string; placeId?: string}};
}

export default defineCommand({
  meta: {name: "unlink", description: t("cmdGoogleUnlink")},
  args: withCommonArgs({
    store: {type: "string", description: t("argGoogleUnlinkStore")}
  }),
  run: runWithContext<UnlinkArgs>(async (ctx, args) => {
    const interactive = isInteractive(ctx.formatExplicit);

    const linked = await fetchLinked(ctx);
    if (!linked.length) throw new AtoaError(t("googleNoLinkedLocations"), "not_found");

    const row = await resolveRow(linked, args.store?.trim(), interactive);
    const storeId = row.merchantStoreId as string;
    const request = {...V1_ROUTES.google.unlinkLocation, pathParams: {storeId}};

    if (ctx.dryRun) {
      ctx.print(request);
      return;
    }

    if (!ctx.yes) {
      if (!interactive) throw new AtoaError(t("googleUnlinkNeedsYes"), "validation");
      const {confirm} = await import("@inquirer/prompts");
      const ok = await confirm({message: t("googleUnlinkConfirm", {place: rowLabel(row)}), default: false});
      if (!ok) {
        process.stderr.write(t("aborted"));
        return;
      }
    }

    await ctx.http.request(request);

    // The endpoint answers 200 with the store id echoed back even when its DELETE matched no row,
    // so the response cannot distinguish a removal from a no-op. Read the listing back instead.
    if ((await fetchLinked(ctx)).some((r) => r.merchantStoreId === storeId)) {
      throw new AtoaError(t("googleUnlinkNotApplied", {store: storeId}), "generic");
    }

    ctx.print({status: "unlinked", store: storeId, placeId: row.metaData?.metadata?.placeId});
  })
});

async function fetchLinked(ctx: CommandContext): Promise<LinkedRow[]> {
  const {data} = await ctx.http.request({...V1_ROUTES.google.linkedLocations});
  return (Array.isArray(data) ? data : []) as LinkedRow[];
}

/** "Ma Berrys — 20 West St, Portadown", falling back to the place id when the listing has no name. */
function rowLabel(row: LinkedRow): string {
  const meta = row.metaData?.metadata;
  const name = meta?.title || meta?.placeId || t("googleUnnamedListing");
  return meta?.address ? `${name} — ${meta.address}` : name;
}

/**
 * Which link to remove. Only stores that actually carry a link are offered: unlinking one that
 * doesn't returns 200 having deleted nothing, so an unfiltered list would report success for a
 * store that was never linked in the first place.
 */
async function resolveRow(linked: LinkedRow[], flag: string | undefined, interactive: boolean): Promise<LinkedRow> {
  const options = linked.map((r) => `${rowLabel(r)} (${r.merchantStoreId})`).join(", ");

  if (flag) {
    const hit = linked.find((r) => r.merchantStoreId === flag);
    if (!hit) throw new AtoaError(t("googleStoreNotLinked", {store: flag, options}), "not_found");
    return hit;
  }
  if (!interactive) {
    throw new AtoaError(t("flagRequiredWithOptions", {flag: "store", options}), "validation");
  }

  const {select} = await import("@inquirer/prompts");
  const storeId = await select<string>({
    message: t("googlePickUnlink"),
    pageSize: 12,
    loop: false,
    choices: linked.map((r) => ({name: rowLabel(r), value: r.merchantStoreId ?? ""}))
  });
  return linked.find((r) => r.merchantStoreId === storeId) as LinkedRow;
}
