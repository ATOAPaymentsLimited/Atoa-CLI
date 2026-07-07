import {defineCommand} from "citty";

export default defineCommand({
  meta: {
    name: "sessions",
    description:
      "Manage login sessions for this account. Warning: revoking the current device session will log this CLI out."
  },
  subCommands: {
    list: () => import("./list").then((m) => m.default),
    revoke: () => import("./revoke").then((m) => m.default)
  }
});
