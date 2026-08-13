import {defineCommand} from "citty";

export default defineCommand({
  meta: {name: "google-review", description: "Google Business Profile review integration for this business"},
  subCommands: {
    status: () => import("./status").then((m) => m.default),
    link: () => import("./link").then((m) => m.default),
    unlink: () => import("./unlink").then((m) => m.default)
  }
});
