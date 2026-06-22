import {defineCommand} from "citty";
import {isProfileIncomplete, readConfig, type EnvState} from "../../lib/config-store";
import {createSecretsStore} from "../../lib/secrets-store";
import {printError, exitCodeFor, type AtoaError} from "../../lib/errors";

export default defineCommand({
  meta: {name: "list", description: "List all business profiles on this machine"},
  args: {
    output: {type: "string", description: "json|table|yaml (default: table)"}
  },
  async run({args}) {
    try {
      const cfg = await readConfig();
      const profiles = cfg.profiles;
      const store = await createSecretsStore();
      const rows = await Promise.all(
        Object.entries(profiles).map(async ([name, p]) => {
          // CLI is JWT-only and the JWT session is env-independent (keyed by profile),
          // so token presence is a single check shared across the env columns.
          const hasToken = !!(await store.getJwtTokens(name));
          return {
            name,
            active: name === cfg.activeProfile,
            displayName: p.displayName,
            defaultEnv: p.defaultEnv ?? null,
            envs: p.envs,
            incomplete: isProfileIncomplete(p),
            hasSandbox: hasToken,
            hasProduction: hasToken
          };
        })
      );

      if (rows.length === 0) {
        process.stdout.write("no profiles configured — run `atoa login`\n");
        return;
      }

      if (args.output === "json") {
        process.stdout.write(JSON.stringify({profiles: rows, backend: store.backend()}, null, 2) + "\n");
        return;
      }

      const headers = ["NAME", "ACTIVE", "BUSINESS", "DEFAULT_ENV", "SANDBOX", "PRODUCTION"];
      const lines: string[][] = rows.map((r) => [
        r.name,
        r.active ? "*" : "",
        r.displayName,
        r.defaultEnv ?? "-",
        formatEnvCell(r.envs.sandbox, r.hasSandbox),
        formatEnvCell(r.envs.production, r.hasProduction)
      ]);
      printTable(headers, lines);

      const incompleteNames = rows.filter((r) => r.incomplete).map((r) => r.name);
      if (incompleteNames.length > 0) {
        process.stdout.write(
          `\nwarning: incomplete profile(s) — ${incompleteNames.join(", ")}. ` +
            "Re-pair via `atoa login` or remove with `atoa logout --profile <name>`.\n"
        );
      }
    } catch (err) {
      printError(err);
      process.exitCode = exitCodeFor((err as AtoaError).kind);
    }
  }
});

/**
 * Renders a per-env cell. Format: `…<fp>` or `-` when empty. If the keychain
 * reports no token despite a config entry, mark with `[!no-token]` so the
 * inconsistency is visible.
 */
function formatEnvCell(state: EnvState | undefined, hasToken: boolean): string {
  if (!state) return "-";
  const fp = state.tokenFingerprint ? `…${state.tokenFingerprint}` : "?";
  const marker = hasToken ? "" : " [!no-token]";
  return `${fp}${marker}`;
}

function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const fmt = (row: string[]) => row.map((cell, i) => cell.padEnd(widths[i])).join("  ");
  process.stdout.write(fmt(headers) + "\n");
  process.stdout.write(widths.map((w) => "-".repeat(w)).join("  ") + "\n");
  for (const r of rows) process.stdout.write(fmt(r) + "\n");
}
