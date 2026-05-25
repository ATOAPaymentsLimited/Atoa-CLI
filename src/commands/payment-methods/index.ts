import {defineCommand} from "citty";

export default defineCommand({
  meta: {name: "payment-methods", description: "Customer payment method (card) management"},
  subCommands: {
    list: () => import("./list").then((m) => m.default),
    get: () => import("./get").then((m) => m.default),
    delete: () => import("./delete").then((m) => m.default)
  }
});
