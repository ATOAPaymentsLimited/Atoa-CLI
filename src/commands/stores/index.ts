import {defineCommand} from "citty";

export default defineCommand({
  meta: {name: "stores", description: "Merchant store operations"},
  subCommands: {
    list: () => import("./list").then((m) => m.default),
    get: () => import("./get").then((m) => m.default),
    image: () => import("./image").then((m) => m.default),
    "link-bank": () => import("./link-bank").then((m) => m.default)
  }
});
