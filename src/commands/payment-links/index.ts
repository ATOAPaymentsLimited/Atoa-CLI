import {defineCommand} from "citty";

export default defineCommand({
  meta: {name: "payment-links", description: "Payment link operations"},
  subCommands: {
    create: () => import("./create").then((m) => m.default),
    get: () => import("./get").then((m) => m.default),
    delete: () => import("./delete").then((m) => m.default)
  }
});
