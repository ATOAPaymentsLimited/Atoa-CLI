import {defineCommand} from "citty";

export default defineCommand({
  meta: {name: "payment-links", description: "Payment link operations"},
  subCommands: {
    create: () => import("./create").then((m) => m.default)
  }
});
