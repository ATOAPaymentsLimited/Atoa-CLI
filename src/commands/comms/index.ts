import {defineCommand} from "citty";
import {t} from "../../lib/i18n";

export default defineCommand({
  meta: {name: "comms", description: t("cmdComms")},
  subCommands: {
    list: () => import("./list").then((m) => m.default),
    set: () => import("./set").then((m) => m.default)
  }
});
