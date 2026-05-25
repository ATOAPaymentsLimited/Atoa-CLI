import {defineCommand} from "citty";

export default defineCommand({
  meta: {name: "refunds", description: "Refund operations"},
  subCommands: {
    create: () => import("./create").then((m) => m.default),
    cancel: () => import("./cancel").then((m) => m.default),
    list: () => import("./list").then((m) => m.default)
  }
});
