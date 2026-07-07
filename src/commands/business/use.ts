import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {setActiveBusinessId} from "../../lib/config-store";
import {AtoaError} from "../../lib/errors";
import {V1_ROUTES} from "../../lib/v1-routes";
import {isInteractive} from "../../lib/output";
import {normalizeBusinesses} from "../../lib/businesses";

type UseArgs = CommonOptions & {businessId: string};

export default defineCommand({
  meta: {
    name: "use",
    description: "Select the active business for subsequent API calls. Validates the ID against the server list."
  },
  args: withCommonArgs({
    businessId: {
      type: "positional",
      required: true,
      description: "business ID to activate"
    }
  }),
  run: runWithContext<UseArgs>(async (ctx, args) => {
    const businessId = (args.businessId as string | undefined)?.trim();
    if (!businessId) {
      throw new AtoaError("businessId is required", "validation");
    }

    // Fetch the list and validate that the supplied ID is present.
    const {data} = await ctx.http.request({...V1_ROUTES.businesses.list});
    const businesses = normalizeBusinesses(data);

    const match = businesses.find((b) => b.id === businessId);
    if (!match) {
      const validIds = businesses.map((b) => b.id);
      throw new AtoaError(`Business "${businessId}" not found. Valid IDs: ${validIds.join(", ")}`, "not_found");
    }

    await setActiveBusinessId(ctx.profileName, businessId);

    if (isInteractive(ctx.formatExplicit)) {
      process.stdout.write(
        `✓ active business set to "${match.legalBusinessName}" (${businessId}) for profile "${ctx.profileName}"\n`
      );
    } else {
      ctx.print({
        profile: ctx.profileName,
        activeBusinessId: businessId,
        legalBusinessName: match.legalBusinessName,
        status: match.status
      });
    }
  })
});
