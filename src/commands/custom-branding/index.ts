import {defineCommand} from "citty";
import {t} from "../../lib/i18n";

export default defineCommand({
  meta: {name: "custom-branding", description: t("cmdCustomBranding")},
  subCommands: {
    get: () => import("./get").then((m) => m.default),
    set: () => import("./set").then((m) => m.default),
    reset: () => import("./reset").then((m) => m.default)
  }
});
