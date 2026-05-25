import {defineCommand} from "citty";

export default defineCommand({
  meta: {name: "payments", description: "Payment request operations"},
  subCommands: {
    create: () => import("./create").then((m) => m.default),
    status: () => import("./status").then((m) => m.default),
    cancel: () => import("./cancel").then((m) => m.default),
    transactions: () => import("./transactions").then((m) => m.default)
  }
});
