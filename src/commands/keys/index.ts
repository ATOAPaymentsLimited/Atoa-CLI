import {defineCommand} from "citty";

export default defineCommand({
  meta: {name: "keys", description: "Manage SDK keys for this merchant (create / list / revoke / regenerate)"},
  subCommands: {
    create: () => import("./create").then((m) => m.default),
    list: () => import("./list").then((m) => m.default),
    revoke: () => import("./revoke").then((m) => m.default),
    regenerate: () => import("./regenerate").then((m) => m.default)
  }
});
