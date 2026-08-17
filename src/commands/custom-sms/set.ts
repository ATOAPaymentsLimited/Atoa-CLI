import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {AtoaError} from "../../lib/errors";
import {validateSmsSenderName} from "../../lib/validators";
import {fetchCustomSenderName} from "./_shared";

type SmsNameSetArgs = CommonOptions & {name: string};

export default defineCommand({
  meta: {name: "set", description: "Set (or rename) the custom SMS sender name for this business"},
  args: withCommonArgs({
    name: {type: "positional", required: true, description: "custom SMS sender name"}
  }),
  run: runWithContext<SmsNameSetArgs>(async (ctx, args) => {
    const customSmsName = args.name?.trim() ?? "";
    // 3–11 characters, alphanumeric plus spaces. The ceiling is the carriers' alphanumeric
    // sender-ID limit, so a longer name is rejected at send time rather than here.
    const verdict = validateSmsSenderName(customSmsName);
    if (verdict !== true) throw new AtoaError(verdict, "validation");

    if (ctx.dryRun) {
      ctx.print({note: "checks for an existing sender name first, then creates or updates", customSmsName});
      return;
    }

    const existing = await fetchCustomSenderName(ctx);

    if (!existing) {
      // First-ever creation for this business needs the options pre-step before a
      // sender name can be created at all. If this fails, abort before the POST —
      // no partial state, either both steps succeed or neither does.
      await ctx.http.request({...V1_ROUTES.options.update, body: {options: {allowBusinessCustomBrandingSms: true}}});

      const {data} = await ctx.http.request({...V1_ROUTES.customSenderName.create, body: {customSmsName}});
      ctx.print(data);
      return;
    }

    // Update skips the pre-step — the business already has the option enabled.
    const {data} = await ctx.http.request({
      ...V1_ROUTES.customSenderName.update,
      pathParams: {customOptionId: existing.id ?? ""},
      body: {customSmsName}
    });
    ctx.print(data);
  })
});
