import {defineCommand} from "citty";
import {withCommonArgs, runWithContext, type CommonOptions} from "../_common";
import {V1_ROUTES} from "../../lib/v1-routes";
import {t} from "../../lib/i18n";
import {fetchCategories} from "./_shared";

/**
 * The permission catalogue, which `roles add`/`update` take ids from.
 *
 * Without this the ids existed only inside the interactive picker, so anyone scripting a role had
 * no way to discover them — `--permission` demands ids and every other surface shows only names.
 */
export default defineCommand({
  meta: {name: "permissions", description: t("cmdRolesPermissions")},
  args: withCommonArgs({}),
  run: runWithContext<CommonOptions>(async (ctx) => {
    if (ctx.dryRun) {
      ctx.print({...V1_ROUTES.permissions.list});
      return;
    }

    const categories = await fetchCategories(ctx);

    // Flattened, with the category on each row: the grouping is useful to read but a nested shape
    // would make the ids harder to pick out of, which is the whole point of the command.
    ctx.print(
      categories.flatMap((category) =>
        (category.permissions ?? []).map((permission) => ({
          id: permission.id,
          name: permission.name,
          category: category.name,
          // Granting one of these grants its prerequisites too, so the caller can see why a role
          // ends up with more than was asked for.
          requires: permission.dependsOnIds?.length ? permission.dependsOnIds : undefined
        }))
      )
    );
  })
});
