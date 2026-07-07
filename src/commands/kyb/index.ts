import {defineCommand} from "citty";

export default defineCommand({
  meta: {name: "kyb", description: "Know-Your-Business (KYB) verification operations"},
  subCommands: {
    status: () => import("./status").then((m) => m.default),
    link: () => import("./link").then((m) => m.default)
  }
});
