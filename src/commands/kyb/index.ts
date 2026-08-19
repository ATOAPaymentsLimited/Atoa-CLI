import {defineCommand} from "citty";
import {t} from "../../lib/i18n";

export default defineCommand({
  meta: {name: "kyb", description: t("cmdKyb")},
  subCommands: {
    status: () => import("./status").then((m) => m.default),
    link: () => import("./link").then((m) => m.default),
    card: () => import("./card").then((m) => m.default)
  }
});
