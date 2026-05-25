import {defineCommand} from "citty";
import {readConfig, resolveActiveProfile} from "../../lib/config-store";
import {createSecretsStore} from "../../lib/secrets-store";
import {printError, exitCodeFor, AtoaError} from "../../lib/errors";

interface ShowArgs {
  name?: string;
  output?: string;
}

export default defineCommand({
  meta: {name: "show", description: "Show metadata for a profile (never includes the token)"},
  args: {
    name: {type: "positional", required: false, description: "profile name (defaults to active profile)"},
    output: {
      type: "string",
      description: "json (machine-readable) | text (default — labeled lines)"
    }
  },
  async run({args: cittyArgs}) {
    const args = cittyArgs as unknown as ShowArgs;
    try {
      const requested = args.name as string | undefined;
      const resolved = await resolveActiveProfile(requested);
      if (resolved.kind === "none") {
        throw new AtoaError("no profiles configured — run `atoa login`", "not_found");
      }
      if (resolved.kind === "ambiguous") {
        throw new AtoaError(
          `multiple profiles configured (${resolved.names.join(", ")}) — pass a name explicitly`,
          "validation"
        );
      }
      const cfg = await readConfig();
      const store = await createSecretsStore();
      const [sb, prod] = await Promise.all([
        store.get(resolved.name, "sandbox"),
        store.get(resolved.name, "production")
      ]);

      const isActive = resolved.name === cfg.activeProfile;

      if (args.output === "json") {
        process.stdout.write(
          JSON.stringify(
            {
              profile: resolved.name,
              active: isActive,
              business: resolved.profile.displayName,
              defaultEnv: resolved.profile.defaultEnv ?? null,
              sandbox: sb ? `…${sb.slice(-4)}` : null,
              production: prod ? `…${prod.slice(-4)}` : null
            },
            null,
            2
          ) + "\n"
        );
        return;
      }

      const lines: string[] = [];
      lines.push(`profile:      ${resolved.name}${isActive ? " (active)" : ""}`);
      lines.push(`business:     ${resolved.profile.displayName}`);
      lines.push(`defaultEnv:   ${resolved.profile.defaultEnv ?? "-"}`);
      lines.push("");
      lines.push(`sandbox:      ${sb ? `…${sb.slice(-4)}` : "not configured"}`);
      lines.push(`production:   ${prod ? `…${prod.slice(-4)}` : "not configured"}`);

      process.stdout.write(lines.join("\n") + "\n");
    } catch (err) {
      printError(err);
      process.exitCode = exitCodeFor((err as AtoaError).kind);
    }
  }
});
