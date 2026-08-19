#!/usr/bin/env node
import {defineCommand, runMain} from "citty";
import {t} from "./lib/i18n";
import packageJson from "../package.json";
import {assertTlsHardenedEnv} from "./lib/bootstrap";
import {printError} from "./lib/errors";
import {handleCompletion, type CompletionShell} from "./lib/completion";

try {
  assertTlsHardenedEnv();
} catch (err) {
  printError(err);
  process.exit(1);
}

const main = defineCommand({
  meta: {
    name: "atoa",
    description: t("cmdRoot"),
    version: packageJson.version
  },
  subCommands: {
    login: () => import("./commands/login").then((m) => m.default),
    logout: () => import("./commands/logout").then((m) => m.default),
    whoami: () => import("./commands/whoami").then((m) => m.default),
    keys: () => import("./commands/keys").then((m) => m.default),
    sessions: () => import("./commands/sessions").then((m) => m.default),
    business: () => import("./commands/business").then((m) => m.default),
    profile: () => import("./commands/profile").then((m) => m.default),
    get: () => import("./commands/get").then((m) => m.default),
    post: () => import("./commands/post").then((m) => m.default),
    delete: () => import("./commands/delete").then((m) => m.default),

    reset: () => import("./commands/reset").then((m) => m.default),
    stores: () => import("./commands/stores").then((m) => m.default),
    bank: () => import("./commands/bank").then((m) => m.default),
    kyb: () => import("./commands/kyb").then((m) => m.default),
    staff: () => import("./commands/staff").then((m) => m.default),
    roles: () => import("./commands/roles").then((m) => m.default),
    "payment-links": () => import("./commands/payment-links").then((m) => m.default),
    signup: () => import("./commands/signup").then((m) => m.default),
    webhooks: () => import("./commands/webhooks").then((m) => m.default),
    addons: () => import("./commands/addons").then((m) => m.default),
    // Group names match the product names for these features, so the same thing is called
    // the same thing wherever a merchant meets it.
    "custom-branding": () => import("./commands/custom-branding").then((m) => m.default),
    "custom-sms": () => import("./commands/custom-sms").then((m) => m.default),
    "direct-debit": () => import("./commands/direct-debit").then((m) => m.default),
    comms: () => import("./commands/comms").then((m) => m.default),

    // SDK-key commands (auth via ~/atoa/auth/secret_key.json; the guard prompts for a key if missing)
    payments: () => import("./commands/payments").then((m) => m.default),
    customers: () => import("./commands/customers").then((m) => m.default),
    "payment-methods": () => import("./commands/payment-methods").then((m) => m.default),
    "card-on-file": () => import("./commands/card-on-file").then((m) => m.default),
    refunds: () => import("./commands/refunds").then((m) => m.default),
    payouts: () => import("./commands/payouts").then((m) => m.default),
    "bank-feed": () => import("./commands/bank-feed").then((m) => m.default),
    institutions: () => import("./commands/institutions").then((m) => m.default),

    completion: () => import("./commands/completion").then((m) => m.default)
  }
});

// Shell-completion fast-path. Runs BEFORE citty arg parsing so every TAB press
// stays cheap. Shape: `atoa --complete-<shell> "<partial line>"`. Intentionally
// avoids any http/keychain access — the resolvers only read local config.
const completeFlagIdx = process.argv.findIndex((a) => /^--complete-(bash|zsh|pwsh)$/.test(a));
if (completeFlagIdx !== -1) {
  const flag = process.argv[completeFlagIdx];
  const shell = flag.replace("--complete-", "") as CompletionShell;
  const line = process.argv[completeFlagIdx + 1] ?? "";
  handleCompletion(main, shell, line).finally(() => process.exit(0));
} else {
  runMain(main);
}
