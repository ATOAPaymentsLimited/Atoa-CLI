import {defineCommand} from "citty";

export default defineCommand({
  meta: {name: "custom-sms", description: "Custom SMS sender name for this business"},
  subCommands: {
    list: () => import("./list").then((m) => m.default),
    set: () => import("./set").then((m) => m.default),
    delete: () => import("./delete").then((m) => m.default)
  }
});
