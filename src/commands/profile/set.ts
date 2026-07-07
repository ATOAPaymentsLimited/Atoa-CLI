import {defineCommand} from "citty";
import {confirm} from "@inquirer/prompts";
import {readProfile, writeProfile, resolveActiveProfile, type Env} from "../../lib/config-store";
import {printError, exitCodeFor, AtoaError} from "../../lib/errors";
import {withCommonArgs} from "../_common";

const SETTABLE_KEYS = ["env"] as const;
type SettableKey = (typeof SETTABLE_KEYS)[number];

function isSettableKey(k: string): k is SettableKey {
  return (SETTABLE_KEYS as readonly string[]).includes(k);
}

export default defineCommand({
  meta: {
    name: "set",
    description: `Set a per-profile setting via key=value (supported keys: ${SETTABLE_KEYS.join(", ")})`
  },
  args: withCommonArgs({
    assignment: {
      type: "positional",
      required: true,
      description: "<key>=<value> — e.g. env=production"
    }
  }),
  async run({args}) {
    try {
      if ((args as {env?: string}).env !== undefined) {
        throw new AtoaError(
          "pass `env=<value>` in the assignment, not `--env <value>`. " +
            "The global --env is a per-command credential-slot selector and has no meaning here.",
          "validation"
        );
      }

      const raw = (args.assignment as string).trim();
      const eq = raw.indexOf("=");
      if (eq <= 0) {
        throw new AtoaError(`expected <key>=<value> (e.g. \`env=production\`), got: "${raw}"`, "validation");
      }
      const key = raw.slice(0, eq).trim();
      const value = raw.slice(eq + 1).trim();

      if (!isSettableKey(key)) {
        throw new AtoaError(`unknown profile key "${key}". Supported keys: ${SETTABLE_KEYS.join(", ")}.`, "validation");
      }

      const resolved = await resolveActiveProfile(args.profile as string | undefined);
      if (resolved.kind === "none") {
        throw new AtoaError("no profiles found — run `atoa login` first", "not_found");
      }
      if (resolved.kind === "ambiguous") {
        throw new AtoaError(
          `multiple profiles configured (${resolved.names.join(", ")}) — pass --profile <name> to scope`,
          "validation"
        );
      }
      const {name: profileName} = resolved;
      const profile = await readProfile(profileName);
      if (!profile) {
        throw new AtoaError(`profile "${profileName}" not found`, "not_found");
      }

      let updated = profile;
      if (key === "env") {
        if (value !== "sandbox" && value !== "production") {
          throw new AtoaError(`env must be "sandbox" or "production", got: "${value}"`, "validation");
        }
        // No per-env credential check: the JWT session is env-independent, and SDK keys are
        // created on demand. `defaultEnv` is just the env that SDK/data commands default to.
        const current = profile.defaultEnv;
        if (current === value) {
          process.stdout.write(`profile "${profileName}" already defaults to ${value} — no change.\n`);
          return;
        }

        if (args.dryRun) {
          process.stdout.write(
            JSON.stringify(
              {action: "profile-set", profile: profileName, key, from: current ?? null, to: value},
              null,
              2
            ) + "\n"
          );
          return;
        }

        if (!args.yes) {
          if (!process.stdin.isTTY) {
            throw new AtoaError(
              `cannot prompt on non-TTY — pass --yes to switch profile "${profileName}" default env ${current ?? "<unset>"} → ${value}.`,
              "validation"
            );
          }
          const ok = await confirm({
            message: `Switch profile "${profileName}" default env from ${current ?? "<unset>"} to ${value}? Subsequent commands without --env will hit ${value}.`,
            default: false
          });
          if (!ok) {
            process.stdout.write("Aborted.\n");
            return;
          }
        }

        updated = {...profile, defaultEnv: value as Env};
      }

      await writeProfile(profileName, updated);
      process.stdout.write(`✓ profile "${profileName}": ${key} = ${value}\n`);
    } catch (err) {
      printError(err);
      process.exitCode = exitCodeFor((err as AtoaError).kind);
    }
  }
});
