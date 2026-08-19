import {describe, it, expect} from "vitest";

// Each command group has an index.ts that wires its subcommands via lazy
// dynamic-import thunks. This test resolves every thunk so that (a) each
// index file and (b) each subcommand module actually loads under coverage.

const INDICES = [
  "bank-feed",
  "card-on-file",
  "customers",
  "institutions",
  "keys",
  "payment-methods",
  "payments",
  "payouts",
  "profile",
  "refunds",
  "stores",
  "webhooks",
  "addons",
  "custom-branding",
  "custom-sms",
  "direct-debit",
  "comms"
];

describe("command index wiring", () => {
  for (const name of INDICES) {
    it(`${name}: every subCommand thunk resolves to a defined module`, async () => {
      const mod = await import(`../../src/commands/${name}`);
      const cmd = mod.default as {
        meta?: {name?: string};
        subCommands?: Record<string, () => Promise<unknown>>;
      };

      expect(cmd).toBeDefined();
      expect(cmd.meta?.name).toBe(name);
      expect(cmd.subCommands).toBeDefined();

      const entries = Object.entries(cmd.subCommands ?? {});
      expect(entries.length).toBeGreaterThan(0);

      for (const [sub, thunk] of entries) {
        const resolved = await thunk();
        expect(resolved, `${name} ${sub} subcommand should resolve`).toBeDefined();
      }
    });
  }
});
