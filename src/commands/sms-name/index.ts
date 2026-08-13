import {defineCommand} from "citty";

export default defineCommand({
  meta: {name: "sms-name", description: "Custom SMS sender name for this business"},
  subCommands: {
    list: () => import("./list").then((m) => m.default),
    set: () => import("./set").then((m) => m.default),
    remove: () => import("./remove").then((m) => m.default)
  }
});
