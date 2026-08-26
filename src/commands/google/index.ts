import {defineCommand} from "citty";
import {t} from "../../lib/i18n";

export default defineCommand({
  meta: {name: "google", description: t("cmdGoogle")},
  subCommands: {
    search: () => import("./search").then((m) => m.default),
    link: () => import("./link").then((m) => m.default),
    unlink: () => import("./unlink").then((m) => m.default),
    locations: () => import("./locations").then((m) => m.default)
  }
});
