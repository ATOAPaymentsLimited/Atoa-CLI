import {defineCommand} from "citty";
import {t} from "../../lib/i18n";

export default defineCommand({
  meta: {
    name: "addons",
    description: t("cmdAddons")
  },
  subCommands: {
    list: () => import("./list").then((m) => m.default),
    upgrade: () => import("./upgrade").then((m) => m.default),
    downgrade: () => import("./downgrade").then((m) => m.default),
    "cancel-downgrade": () => import("./cancel-downgrade").then((m) => m.default)
  }
});
