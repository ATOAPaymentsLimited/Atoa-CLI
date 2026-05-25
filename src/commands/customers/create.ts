import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {AtoaError} from "../../lib/errors";

type CreateArgs = CommonOptions & {
  fullName?: string;
  email?: string;
  type?: string;
  phoneCountryCode?: string;
  phoneNumber?: string;
  address?: string;
  city?: string;
  postcode?: string;
  vatNumber?: string;
};

export default defineCommand({
  meta: {name: "create", description: "Create a customer"},
  args: withCommonArgs({
    fullName: {type: "string", required: true, description: "customer full name (2-30 chars)"},
    email: {type: "string", description: "customer email (either --email or --phoneNumber is required)"},
    type: {type: "string", description: "customer type: INDIVIDUAL (default) or BUSINESS"},
    phoneCountryCode: {type: "string", description: 'phone country code, digits only e.g. "44" for UK'},
    phoneNumber: {type: "string", description: "phone number (digits only, either --email or --phoneNumber is required)"},
    address: {type: "string", description: "street address"},
    city: {type: "string", description: "city"},
    postcode: {type: "string", description: "postal code"},
    vatNumber: {type: "string", description: "VAT registration number (business customers)"}
  }),
  run: runWithContext<CreateArgs>(async (ctx, args) => {
    if (!args.email && !args.phoneNumber) {
      throw new AtoaError("either --email or --phoneNumber is required", "validation");
    }

    const body = {
      fullName: args.fullName as string,
      ...(args.email && {email: args.email}),
      ...(args.type && {type: args.type}),
      ...(args.phoneCountryCode && {phoneCountryCode: args.phoneCountryCode}),
      ...(args.phoneNumber && {phoneNumber: args.phoneNumber}),
      ...(args.address && {address: args.address}),
      ...(args.city && {city: args.city}),
      ...(args.postcode && {postcode: args.postcode}),
      ...(args.vatNumber && {vatNumber: args.vatNumber})
    };

    if (ctx.dryRun) {
      ctx.print({method: "POST", path: "/api/customers", body});
      return;
    }

    const {data} = await ctx.http.request({
      method: "POST",
      path: "/api/customers",
      body
    });
    ctx.print(data);
  })
});
