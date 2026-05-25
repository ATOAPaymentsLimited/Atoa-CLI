import {defineCommand} from "citty";

export default defineCommand({
  meta: {name: "payouts", description: "Payout operations"},
  subCommands: {
    list: () => import("./list").then((m) => m.default),
    transactions: () => import("./transactions").then((m) => m.default)
  }
});
