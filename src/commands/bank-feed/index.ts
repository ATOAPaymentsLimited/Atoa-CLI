import {defineCommand} from "citty";

export default defineCommand({
  meta: {name: "bank-feed", description: "Bank feed (Account Information Services / Open Banking)"},
  subCommands: {
    initiate: () => import("./initiate").then((m) => m.default),
    accounts: () => import("./accounts").then((m) => m.default),
    account: () => import("./account").then((m) => m.default),
    balance: () => import("./balance").then((m) => m.default),
    transactions: () => import("./transactions").then((m) => m.default),
    revoke: () => import("./revoke").then((m) => m.default)
  }
});
