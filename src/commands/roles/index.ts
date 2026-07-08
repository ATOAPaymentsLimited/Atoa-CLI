import {defineCommand} from "citty";

export default defineCommand({
  meta: {name: "roles", description: "Business role operations"},
  subCommands: {
    list: () => import("./list").then((m) => m.default)
  }
});
