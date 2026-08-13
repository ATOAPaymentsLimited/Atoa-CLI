import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {AtoaError} from "../../lib/errors";

type BrandingSetArgs = CommonOptions & {colorCode: string};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export default defineCommand({
  meta: {name: "set", description: "Set the checkout page theme colour"},
  args: withCommonArgs({
    colorCode: {type: "positional", required: true, description: "hex colour code, e.g. #FF0000"}
  }),
  run: runWithContext<BrandingSetArgs>(async (ctx, args) => {
    const colorCode = args.colorCode?.trim();
    if (!colorCode) throw new AtoaError("colorCode is required", "validation");
    if (!HEX_COLOR.test(colorCode))
      throw new AtoaError("colorCode must be a 6-digit hex colour, e.g. #FF0000", "validation");

    const body = {theme: {colorCode}};

    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.options.update, body});
      return;
    }
    // MERCHANT_CUSTOM_BRAND_CHECKOUT_PAGE addon gate is enforced server-side —
    // its error surfaces as-is via AtoaError.
    const {data} = await ctx.http.request({...V1_ROUTES.options.update, body});
    const options = (data ?? {}) as {theme?: {colorCode?: string}};
    ctx.print({colorCode: options.theme?.colorCode});
  })
});
