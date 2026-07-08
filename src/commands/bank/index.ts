import {defineCommand} from "citty";

export default defineCommand({
  meta: {name: "bank", description: "Merchant bank account operations"},
  subCommands: {
    list: () => import("./list").then((m) => m.default),
    get: () => import("./get").then((m) => m.default),
    add: () => import("./add").then((m) => m.default),
    delete: () => import("./delete").then((m) => m.default)
  }
});
