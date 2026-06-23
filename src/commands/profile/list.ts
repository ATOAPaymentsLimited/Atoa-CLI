import {defineCommand} from "citty";
import {readConfig} from "../../lib/config-store";
import {createSecretsStore} from "../../lib/secrets-store";
import {printError, exitCodeFor, type AtoaError} from "../../lib/errors";

export default defineCommand({
  meta: {name: "list", description: "List the signed-in business profiles on this machine"},
  args: {
    output: {type: "string", description: "json (default: human-readable list)"}
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

      if (args.output === "json") {
        const profiles = rows.map((r) => ({name: r.name, active: r.active, business: r.business}));
        process.stdout.write(JSON.stringify({profiles, backend: store.backend()}, null, 2) + "\n");
        return;
      }

      // Aligned list; the active profile is marked with `*`.
      const pad = Math.max(...rows.map((r) => r.name.length));
      process.stdout.write(`Profiles (${rows.length})\n\n`);
      for (const r of rows) {
        process.stdout.write(`  ${r.active ? "*" : " "} ${r.name.padEnd(pad)}  ${r.business}\n`);
      }
    } catch (err) {
      printError(err);
      process.exitCode = exitCodeFor((err as AtoaError).kind);
    }
  }
});
