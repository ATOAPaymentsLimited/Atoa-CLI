import {defineCommand} from "citty";

export default defineCommand({
  meta: {name: "branding", description: "Checkout page branding (theme colour)"},
  subCommands: {
    get: () => import("./get").then((m) => m.default),
    set: () => import("./set").then((m) => m.default),
    reset: () => import("./reset").then((m) => m.default)
  }
});
