import {defineCommand} from "citty";
import {confirm} from "@inquirer/prompts";
import {unlink} from "fs/promises";
import {configFilePath, readConfig, type EnvState} from "../lib/config-store";
import {sessionFilePath, lockFilePath} from "../lib/secrets-store";
import {sdkKeyFilePath, findSdkKey} from "../lib/sdk-key-file";
import {buildHttpClient, assertTlsHardenedEnv} from "../lib/http";
import {resolveBaseUrl} from "../lib/env";
import {buildAuthHeader} from "../lib/auth";
import {printError, exitCodeFor, type AtoaError} from "../lib/errors";
import {LOCAL_DRY_RUN_ARG, LOCAL_YES_ARG} from "./_common";

type Env = "sandbox" | "production";

export default defineCommand({
  meta: {
    name: "reset",
    description:
      "Delete ALL local profiles and stored credentials. Optionally revoke them server-side first (best-effort)."
  },
  args: {
    revoke: {
      type: "boolean",
      description: "revoke each profile's server-side keys before clearing locally (best-effort)"
    },
    ...LOCAL_YES_ARG,
    ...LOCAL_DRY_RUN_ARG
  },
  async run({args}) {
    try {
      let config;
      try {
        config = await readConfig();
      } catch (err) {
        // Config corrupt — still try to wipe files. Skip the revoke step.
        process.stderr.write(`note: ${(err as Error).message}\n`);
        config = {schemaVersion: 1 as const, profiles: {}};
      }

      const profileNames = Object.keys(config.profiles);

      // Dry-run preview FIRST — before the confirm prompt, so users can safely
      // see what `--revoke` would do without committing to anything.
      if (args.dryRun) {
        const targets: Array<{profile: string; env: Env; sdkAccessId: string | undefined}> = [];
        for (const [name, profile] of Object.entries(config.profiles)) {
          for (const env of ["sandbox", "production"] as Env[]) {
            const state = profile.envs[env];
            if (!state) continue;
            targets.push({profile: name, env, sdkAccessId: state.sdkAccessId});
          }
        }
        process.stdout.write(
          JSON.stringify(
            {
              action: "reset",
              willClearProfiles: profileNames,
              willWipeFiles: [configFilePath(), sessionFilePath(), sdkKeyFilePath()],
              willRevoke: args.revoke ? targets : []
            },
            null,
            2
          ) + "\n"
        );
        return;
      }

      if (profileNames.length === 0) {
        // Even with no profiles, the user might want to wipe stray files.
        await wipeFiles();
        process.stdout.write("Nothing to clear.\n");
        return;
      }

      if (!args.yes) {
        const ok = await confirm({
          message: `Delete all local state? This removes ${profileNames.length} profile(s) and clears all stored tokens.`,
          default: false
        });
        if (!ok) {
          process.stdout.write("Aborted.\n");
          return;
        }
      }

      // Best-effort revoke call per env per profile, in parallel.
      // Serial would 30s-timeout × N profiles × 2 envs in the worst case — a
      // failing endpoint blocks the whole reset for minutes. Promise.allSettled
      // bounds the total time to the slowest single call.
      let revokedCount = 0;
      if (args.revoke) {
        const jobs: Array<Promise<boolean>> = [];
        for (const [name, profile] of Object.entries(config.profiles)) {
          for (const env of ["sandbox", "production"] as Env[]) {
            const state = profile.envs[env];
            if (!state) continue;
            jobs.push(tryRevoke(name, env, state));
          }
        }
        const results = await Promise.allSettled(jobs);
        revokedCount = results.filter((r) => r.status === "fulfilled" && r.value).length;
      }

      // Wipe the on-disk files. The store is file-only, so deleting session.json
      // wholesale clears every profile's tokens — no need for per-profile,
      // lock-acquiring deleteProfile calls (which would themselves hang on an
      // orphaned lock, the very state reset exists to recover from).
      await wipeFiles();

      process.stdout.write(
        `✓ Cleared ${profileNames.length} profile(s)` +
          (args.revoke ? `; revoked ${revokedCount} server-side key(s)` : "") +
          "\n"
      );
    } catch (err) {
      printError(err);
      process.exitCode = exitCodeFor((err as AtoaError).kind);
    }
  }
});

async function wipeFiles(): Promise<void> {
  // Include the lockfile: a stale one left by a killed process is exactly what
  // reset must be able to clear, so it's deleted directly here rather than acquired.
  for (const fp of [configFilePath(), sessionFilePath(), lockFilePath(), sdkKeyFilePath()]) {
    await unlink(fp).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== "ENOENT") throw err;
    });
  }
}

async function tryRevoke(profileName: string, env: Env, state: EnvState): Promise<boolean> {
  const endpoint = revokeEndpointFor(state);
  if (!endpoint) {
    process.stderr.write(
      `  skipping server revoke for ${profileName}/${env}: no sdkAccessId recorded. Use the dashboard.\n`
    );
    return false;
  }

  const stored = state.sdkAccessId ? await findSdkKey(state.sdkAccessId) : undefined;
  const token = stored?.apiSecret;
  if (!token) {
    process.stderr.write(
      `  skipping server revoke for ${profileName}/${env}: no stored secret for ${endpoint.label}. Revoke it from the dashboard.\n`
    );
    return false;
  }

  try {
    assertTlsHardenedEnv();
    const http = buildHttpClient({
      baseUrl: resolveBaseUrl(),
      authHeader: buildAuthHeader(token),
      verbose: false
    });
    await http.request({
      method: "DELETE",
      path: endpoint.path,
      query: {env: env.toUpperCase()}
    });
    process.stdout.write(`  ✓ revoked ${profileName}/${env} (${endpoint.label})\n`);
    return true;
  } catch (err) {
    process.stderr.write(`  warning: server revoke failed for ${profileName}/${env}: ${(err as Error).message}\n`);
    return false;
  }
}

/**
 * Resolves the DELETE endpoint + a human-readable label for the success line.
 * Returns null when no sdkAccessId is recorded — caller skips the revoke and
 * logs a notice. Revocability is determined by the API response; the CLI just
 * forwards the request.
 */
function revokeEndpointFor(state: EnvState): {path: string; label: string} | null {
  if (!state.sdkAccessId) return null;
  return {
    path: `/api/cli/api-access/${encodeURIComponent(state.sdkAccessId)}`,
    label: state.sdkAccessId
  };
}
