import {defineCommand} from "citty";
import {readFile} from "fs/promises";
import {basename} from "path";
import {FormData} from "undici";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {AtoaError} from "../../lib/errors";

type StoresImageArgs = CommonOptions & {file: string; storeId?: string};

const CONTENT_TYPES: Record<string, string> = {png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg"};

export default defineCommand({
  meta: {name: "image", description: "Upload or replace a store's logo image (PNG/JPG/JPEG, max 6MB)"},
  args: withCommonArgs({
    file: {type: "positional", required: true, description: "path to the image file (PNG/JPG/JPEG)"},
    storeId: {type: "string", description: "store ID (defaults to the primary store)"}
  }),
  run: runWithContext<StoresImageArgs>(async (ctx, args) => {
    const filePath = args.file?.trim();
    if (!filePath) throw new AtoaError("file path is required", "validation");

    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    const type = CONTENT_TYPES[ext];
    if (!type) throw new AtoaError("image must be a .png, .jpg or .jpeg file", "validation");

    const query: Record<string, string> = {};
    if (args.storeId) query["storeId"] = args.storeId;

    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.logo.upload, query, file: filePath});
      return;
    }

    let buf: Buffer;
    try {
      buf = await readFile(filePath);
    } catch {
      throw new AtoaError(`cannot read file: ${filePath}`, "validation");
    }

    const form = new FormData();
    // The backend (POST /api/merchant/:businessId/store/store-image) reads the
    // multipart field named "photo" (@MultipartFile("photo")).
    form.append("photo", new Blob([buf], {type}), basename(filePath));

    const {data} = await ctx.http.request({...V1_ROUTES.logo.upload, query, rawBody: form});

    // Response is a MerchantStore entity (not the old {storeId, logoUrl}). Surface
    // the store id and the uploaded image URLs defensively — `images[].urls` is a
    // {size: url} map on each MerchantStoreImage.
    const store = (data ?? {}) as {id?: string; images?: Array<{id?: string; urls?: Record<string, string>}>};
    ctx.print({
      storeId: store.id,
      images: (store.images ?? []).map((img) => ({id: img.id, urls: img.urls}))
    });
  })
});
