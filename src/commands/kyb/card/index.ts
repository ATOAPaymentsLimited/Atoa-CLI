import {defineCommand} from "citty";
import {t} from "../../../lib/i18n";

export default defineCommand({
  meta: {name: "card", description: t("cmdKybCard")},
  subCommands: {
    status: () => import("./status").then((m) => m.default),
    link: () => import("./link").then((m) => m.default)
  }
});
