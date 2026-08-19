import {defineCommand} from "citty";
import {t} from "../../lib/i18n";

export default defineCommand({
  meta: {
    name: "direct-debit",
    description: t("cmdDirectDebit")
  },
  subCommands: {
    setup: () => import("./setup").then((m) => m.default),
    status: () => import("./status").then((m) => m.default)
  }
});
