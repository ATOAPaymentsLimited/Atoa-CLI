import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {isInteractive} from "../../lib/output";
import {AtoaError} from "../../lib/errors";

type Field =
  | "sortCode"
  | "accountNumber"
  | "name"
  | "email"
  | "addressLine1"
  | "addressLine2"
  | "city"
  | "postalCode"
  | "country"
  | "state";

type DirectDebitSetupArgs = CommonOptions & Partial<Record<Field, string>>;

const PROMPTS: Record<Field, string> = {
  sortCode: "Sort code",
  accountNumber: "Account number",
  name: "Account holder name",
  email: "Billing email",
  addressLine1: "Billing address line 1",
  addressLine2: "Billing address line 2 (optional)",
  city: "Billing city",
  postalCode: "Billing postal code",
  country: "Billing country code, e.g. GB",
  state: "Billing state/region (optional — many UK addresses leave this blank)"
};

const REQUIRED: Field[] = [
  "sortCode",
  "accountNumber",
  "name",
  "email",
  "addressLine1",
  "city",
  "postalCode",
  "country"
];

export default defineCommand({
  meta: {
    name: "setup",
    description:
      "Set up the direct-debit mandate for platform fees. Collects bank and billing details, then " +
      "confirms the mandate. Not yet exercised against a real business — verify before relying on it."
  },
  args: withCommonArgs({
    sortCode: {type: "string", description: "6-digit UK sort code"},
    accountNumber: {type: "string", description: "8-digit UK account number"},
    name: {type: "string", description: "account holder name"},
    email: {type: "string", description: "billing email"},
    addressLine1: {type: "string", description: "billing address line 1"},
    addressLine2: {type: "string", description: "billing address line 2"},
    city: {type: "string", description: "billing city"},
    postalCode: {type: "string", description: "billing postal code"},
    country: {type: "string", description: "billing country code, e.g. GB"},
    state: {type: "string", description: "billing state/region"}
  }),
  run: runWithContext<DirectDebitSetupArgs>(async (ctx, args) => {
    const interactive = isInteractive(ctx.formatExplicit);
    const fields: Partial<Record<Field, string>> = {...args};

    if (interactive) {
      const {input} = await import("@inquirer/prompts");
      for (const key of Object.keys(PROMPTS) as Field[]) {
        if (!fields[key]?.trim()) {
          const answer = (await input({message: PROMPTS[key]})).trim();
          if (answer) fields[key] = answer;
        }
      }
    }

    for (const key of REQUIRED) {
      if (!fields[key]?.trim()) throw new AtoaError(`--${toFlag(key)} is required`, "validation");
    }

    // Check whether a mandate is already active — replacing bank details needs an
    // explicit confirm so this never silently creates a duplicate mandate.
    const {data: assigned} = await ctx.http.request({...V1_ROUTES.directDebit.assignedPlan});
    const plan = (assigned ?? {}) as {isDirectDebitSetup?: boolean};
    let updateBacs = false;
    if (plan.isDirectDebitSetup) {
      if (!interactive) {
        throw new AtoaError(
          "a direct-debit mandate is already active — re-run interactively to confirm replacing it",
          "validation"
        );
      }
      const {confirm} = await import("@inquirer/prompts");
      const ok = await confirm({
        message: "A direct-debit mandate is already active — replace the bank details?",
        default: false
      });
      if (!ok) return;
      updateBacs = true;
    }

    const body = {
      mandate_data: {
        customer_acceptance: {
          type: "online",
          accepted_at: Math.floor(Date.now() / 1000),
          online: {ip_address: "0.0.0.0", user_agent: "atoa-cli"}
        }
      },
      payment_method_data: {
        type: "bacs_debit",
        bacs_debit: {account_number: fields.accountNumber, sort_code: fields.sortCode},
        billing_details: {
          name: fields.name,
          email: fields.email,
          address: {
            line1: fields.addressLine1,
            line2: fields.addressLine2 || undefined,
            city: fields.city,
            postal_code: fields.postalCode,
            country: fields.country,
            state: fields.state || ""
          }
        }
      },
      updateBacs
    };

    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.directDebit.confirmSetup, body});
      return;
    }

    await ctx.http.request({...V1_ROUTES.directDebit.confirmSetup, body});
    const {data: confirmed} = await ctx.http.request({...V1_ROUTES.directDebit.assignedPlan});
    ctx.print(confirmed);
  })
});

function toFlag(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}
