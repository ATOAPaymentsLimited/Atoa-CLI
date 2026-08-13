import {defineCommand} from "citty";

export default defineCommand({
  meta: {
    name: "addons",
    description: "Addon plan and feature usage for this business (upgrade/downgrade change billing)"
  },
  subCommands: {
    list: () => import("./list").then((m) => m.default),
    upgrade: () => import("./upgrade").then((m) => m.default),
    downgrade: () => import("./downgrade").then((m) => m.default),
    "cancel-downgrade": () => import("./cancel-downgrade").then((m) => m.default)
  }
});
