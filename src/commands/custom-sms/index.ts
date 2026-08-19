import {defineCommand} from "citty";
import {t} from "../../lib/i18n";

export default defineCommand({
  meta: {name: "custom-sms", description: t("cmdCustomSms")},
  subCommands: {
    list: () => import("./list").then((m) => m.default),
    set: () => import("./set").then((m) => m.default),
    delete: () => import("./delete").then((m) => m.default)
  }
});
