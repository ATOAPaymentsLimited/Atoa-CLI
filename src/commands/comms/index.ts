import {defineCommand} from "citty";

export default defineCommand({
  meta: {name: "comms", description: "Per-topic notification channel preferences"},
  subCommands: {
    list: () => import("./list").then((m) => m.default),
    set: () => import("./set").then((m) => m.default)
  }
});
