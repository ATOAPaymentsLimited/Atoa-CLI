import {defineCommand} from "citty";
import {readConfig} from "../../lib/config-store";
import {createSecretsStore} from "../../lib/secrets-store";
import {printError, exitCodeFor, type AtoaError} from "../../lib/errors";
import {print, resolveFormat} from "../../lib/output";

export default defineCommand({
  meta: {name: "list", description: "List the signed-in business profiles on this machine"},
  args: {
    output: {type: "string", description: "json|table|yaml (default: table)"}
  },
  async run({args}) {
    try {
      const cfg = await readConfig();
      const store = await createSecretsStore();

      // CLI is JWT-only; a profile is usable only if it has a stored JWT session.
      // Profiles without one would need `atoa login` anyway, so they're omitted.
      const rows = (
        await Promise.all(
          Object.entries(cfg.profiles).map(async ([name, p]) => ({
            name,
            active: name === cfg.activeProfile,
            business: p.displayName,
            hasToken: !!(await store.getJwtTokens(name))
          }))
        )
      ).filter((r) => r.hasToken);

      if (rows.length === 0) {
        process.stdout.write("no signed-in profiles — run `atoa login`\n");
        return;
      }

      // Explicit --output honoured; default to a table for humans.
      const format = args.output ? resolveFormat(args.output) : "table";

      // Keep the richer object shape for scripts; `active` stays a boolean there.
      if (format === "json") {
        const profiles = rows.map((r) => ({name: r.name, active: r.active, business: r.business}));
        print({profiles, backend: store.backend()}, "json");
        return;
      }

      // Tabular / yaml view: the active profile is marked with `*` in its own column.
      print(
        rows.map((r) => ({active: r.active ? "*" : "", name: r.name, business: r.business})),
        format
      );
    } catch (err) {
      printError(err);
      process.exitCode = exitCodeFor((err as AtoaError).kind);
    }
  }
});
