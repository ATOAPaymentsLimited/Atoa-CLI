import {defineCommand} from "citty";

export default defineCommand({
  meta: {name: "webhooks", description: "Merchant webhook management"},
  subCommands: {
    create: () => import("./create").then((m) => m.default),
    list: () => import("./list").then((m) => m.default),
    delete: () => import("./delete").then((m) => m.default),
    trigger: () => import("./trigger").then((m) => m.default)
  }
});
