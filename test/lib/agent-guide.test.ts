import {describe, it, expect} from "vitest";
import {readFileSync, existsSync} from "node:fs";
import {resolve} from "node:path";

/**
 * AGENTS.md (and its CLAUDE.md pointer) is the contract an agent reads before touching a real
 * merchant account, and a flag
 * renamed in code but not in the doc fails at runtime looking like a CLI bug. A one-off check
 * goes stale the moment the next flag lands, so the check lives here instead.
 *
 * Mirrors the subCommands map in src/cli.ts. A new top-level group must be added to both.
 */
const GROUPS = [
  "login",
  "logout",
  "whoami",
  "keys",
  "sessions",
  "business",
  "profile",
  "get",
  "post",
  "delete",
  "reset",
  "stores",
  "bank",
  "kyb",
  "staff",
  "roles",
  "payment-links",
  "signup",
  "webhooks",
  "addons",
  "custom-branding",
  "custom-sms",
  "direct-debit",
  "comms",
  "google",
  "payments",
  "customers",
  "payment-methods",
  "card-on-file",
  "refunds",
  "payouts",
  "bank-feed",
  "institutions",
  "completion"
];

type Cmd = {args?: Record<string, unknown>; subCommands?: Record<string, unknown>};

async function collectFlags(cmd: Cmd, into: Set<string>): Promise<void> {
  for (const name of Object.keys(cmd.args ?? {})) into.add(name);
  const subs = typeof cmd.subCommands === "function" ? await (cmd.subCommands as () => unknown)() : cmd.subCommands;
  for (const entry of Object.values((subs ?? {}) as Record<string, unknown>)) {
    const sub = (typeof entry === "function" ? await (entry as () => unknown)() : entry) as {default?: Cmd} & Cmd;
    await collectFlags(sub.default ?? sub, into);
  }
}

/** --location-name and --locationName are the same flag; compare on one spelling. */
const canonical = (s: string) => s.replace(/^--/, "").replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());

describe("the agent guide stays in step with the CLI", () => {
  const docPaths = ["AGENTS.md"].map((f) => resolve(__dirname, "../..", f));

  it("references no flag the CLI doesn't define", async () => {
    const present = docPaths.filter((p) => existsSync(p));
    if (!present.length) return; // docs are optional; nothing to verify
    const real = new Set<string>(["env", "output", "verbose", "dryRun", "yes", "profile", "help", "version"]);

    for (const g of GROUPS) {
      const mod = (await import(`../../src/commands/${g}`)) as {default: Cmd};
      await collectFlags(mod.default, real);
    }
    const known = new Set([...real].map((f) => canonical(f)));

    const doc = present.map((p) => readFileSync(p, "utf8")).join("\n");
    const used = [...new Set(doc.match(/--[a-zA-Z][\w-]*/g) ?? [])];
    const unknown = used.filter((f) => !known.has(canonical(f)));

    expect({unknown, checked: used.length}).toEqual({unknown: [], checked: used.length});
    // Importing all 33 command modules lands near vitest's 5s default, which made this fail
    // intermittently under parallel load. The work is real, so raise the limit rather than trim it.
  }, 30_000);
});
