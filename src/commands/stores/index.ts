import {defineCommand} from "citty";

export default defineCommand({
  meta: {name: "stores", description: "Merchant store operations"},
  subCommands: {
    list: () => import("./list").then((m) => m.default)
  }
});
