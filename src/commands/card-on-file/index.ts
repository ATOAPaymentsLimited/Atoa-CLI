import {defineCommand} from "citty";

export default defineCommand({
  meta: {name: "card-on-file", description: "Saved-card (card-on-file) charging"},
  subCommands: {
    charge: () => import("./charge").then((m) => m.default),
    capture: () => import("./capture").then((m) => m.default),
    cancel: () => import("./cancel").then((m) => m.default)
  }
});
