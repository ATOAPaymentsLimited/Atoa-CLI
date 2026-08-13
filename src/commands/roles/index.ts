import {defineCommand} from "citty";

export default defineCommand({
  meta: {name: "roles", description: "Business role operations"},
  subCommands: {
    list: () => import("./list").then((m) => m.default),
    create: () => import("./create").then((m) => m.default),
    update: () => import("./update").then((m) => m.default),
    delete: () => import("./delete").then((m) => m.default)
  }
});
