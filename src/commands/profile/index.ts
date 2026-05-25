import {defineCommand} from "citty";

export default defineCommand({
  meta: {name: "profile", description: "Manage merchant profiles stored on this machine"},
  subCommands: {
    list: () => import("./list").then((m) => m.default),
    use: () => import("./use").then((m) => m.default),
    show: () => import("./show").then((m) => m.default),
    set: () => import("./set").then((m) => m.default),
    rename: () => import("./rename").then((m) => m.default),
    delete: () => import("./delete").then((m) => m.default)
  }
});
