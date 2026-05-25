import {defineCommand} from "citty";

export default defineCommand({
  meta: {name: "customers", description: "Customer management"},
  subCommands: {
    create: () => import("./create").then((m) => m.default),
    list: () => import("./list").then((m) => m.default),
    get: () => import("./get").then((m) => m.default),
    update: () => import("./update").then((m) => m.default),
    delete: () => import("./delete").then((m) => m.default)
  }
});
