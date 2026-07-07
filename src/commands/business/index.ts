import {defineCommand} from "citty";

export default defineCommand({
  meta: {
    name: "business",
    description: "Manage the active business for JWT-authenticated API calls."
  },
  subCommands: {
    list: () => import("./list").then((m) => m.default),
    use: () => import("./use").then((m) => m.default)
  }
});
