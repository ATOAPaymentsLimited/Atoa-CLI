import {defineCommand} from "citty";

export default defineCommand({
  meta: {
    name: "direct-debit",
    description: "Direct-debit mandate for platform fees"
  },
  subCommands: {
    setup: () => import("./setup").then((m) => m.default),
    status: () => import("./status").then((m) => m.default)
  }
});
