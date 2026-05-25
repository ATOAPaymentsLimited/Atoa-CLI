import {defineCommand} from "citty";

export default defineCommand({
  meta: {name: "institutions", description: "Payment institution lookup"},
  subCommands: {
    list: () => import("./list").then((m) => m.default)
  }
});
