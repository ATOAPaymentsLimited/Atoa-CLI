import {defineCommand} from "citty";
import {withCommonArgs, runWithSdkKey, type CommonOptions} from "../_common";

type UpdateArgs = CommonOptions & {
  id?: string;
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
  meta: {name: "update", description: "Update a customer (all fields optional)"},
  args: withCommonArgs({
    id: {type: "positional", required: true, description: "customer ID"},
    fullName: {type: "string", description: "customer full name (2-30 chars)"},
    email: {type: "string", description: "customer email (valid email format)"},
    type: {type: "string", description: "customer type: INDIVIDUAL or BUSINESS"},
    phoneCountryCode: {type: "string", description: 'phone country code, digits only e.g. "44" for UK'},
    phoneNumber: {type: "string", description: "phone number (digits only)"},
    address: {type: "string", description: "street address"},
    city: {type: "string", description: "city"},
    postcode: {type: "string", description: "postal code"},
    vatNumber: {type: "string", description: "VAT registration number (business customers)"}
  }),
  run: runWithSdkKey<UpdateArgs>(async (ctx, args) => {
    const body = {
      ...(args.fullName && {fullName: args.fullName}),
      ...(args.email && {email: args.email}),
      ...(args.type && {type: args.type}),
      ...(args.phoneCountryCode && {phoneCountryCode: args.phoneCountryCode}),
      ...(args.phoneNumber && {phoneNumber: args.phoneNumber}),
      ...(args.address && {address: args.address}),
      ...(args.city && {city: args.city}),
      ...(args.postcode && {postcode: args.postcode}),
      ...(args.vatNumber && {vatNumber: args.vatNumber})
    };

    const path = `/api/customers/${encodeURIComponent(args.id as string)}`;

    if (ctx.dryRun) {
      ctx.print({method: "PUT", path, body});
      return;
    }

    const {data} = await ctx.http.request({method: "PUT", path, body});
    ctx.print(data);
  })
});
