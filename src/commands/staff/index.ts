import {defineCommand} from "citty";
import {t} from "../../lib/i18n";

export default defineCommand({
  meta: {name: "staff", description: t("cmdStaff")},
  subCommands: {
    list: () => import("./list").then((m) => m.default),
    invite: () => import("./invite").then((m) => m.default),
    add: () => import("./add").then((m) => m.default),
    update: () => import("./update").then((m) => m.default),
    delete: () => import("./delete").then((m) => m.default)
  }
});
