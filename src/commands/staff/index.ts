import {defineCommand} from "citty";

export default defineCommand({
  meta: {name: "staff", description: "Staff / business-user management"},
  subCommands: {
    list: () => import("./list").then((m) => m.default),
    invite: () => import("./invite").then((m) => m.default)
  }
});
