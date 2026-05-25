import {defineCommand} from "citty";

export default defineCommand({
  meta: {name: "keys", description: "Manage SDK keys for this merchant (revoke / regenerate)"},
  subCommands: {
    revoke: () => import("./revoke").then((m) => m.default),
    regenerate: () => import("./regenerate").then((m) => m.default)
  }
});
