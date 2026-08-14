import {defineCommand} from "citty";

export default defineCommand({
  meta: {name: "card", description: "Card-payment activation (post-KYB) operations"},
  subCommands: {
    status: () => import("./status").then((m) => m.default),
    link: () => import("./link").then((m) => m.default)
  }
});
