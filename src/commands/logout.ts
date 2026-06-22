import {defineCommand} from "citty";
import {confirm, select} from "@inquirer/prompts";
import {parseEnvFlag, resolveBaseUrl, type Env} from "../lib/env";
import {buildAuthHeader} from "../lib/auth";
import {buildHttpClient, assertTlsHardenedEnv} from "../lib/http";
import {createSecretsStore, type SecretsStore} from "../lib/secrets-store";
import {
  deleteProfile as deleteProfileEntry,
  readConfig,
  readProfile,
  resolveActiveProfile,
  writeProfile,
  type ProfileConfig
} from "../lib/config-store";
import {AtoaError, printError, exitCodeFor} from "../lib/errors";
import {LOCAL_DRY_RUN_ARG} from "./_common";
import {V1_ROUTES} from "../lib/v1-routes";

interface LogoutArgs {
  env?: string;
  profile?: string;
  revoke?: boolean;
  purgeKey?: boolean;
  yes?: boolean;
  dryRun?: boolean;
}

export default defineCommand({
  meta: {
    name: "logout",
    description:
      "Log out of one env on a profile. Picks the env interactively when both are configured. To log out of everything, run logout twice."
  },
  args: {
    env: {
      type: "string",
      description:
        "sandbox|production (skips the interactive prompt; required in non-TTY when both envs are configured)"
    },
    profile: {type: "string", description: "profile to log out from (defaults to active profile)"},
    revoke: {
      type: "boolean",
      description: "also revoke the env on the server (best-effort, destructive across machines that share this key)"
    },
    purgeKey: {
      type: "boolean",
      description: "jwt mode: also remove the stored SDK token when clearing JWT credentials"
    },
    yes: {type: "boolean", description: "skip the confirm prompt (env prompt still fires unless --env is supplied)"},
    ...LOCAL_DRY_RUN_ARG
  },
  async run({args: cittyArgs}) {
    const args = cittyArgs as unknown as LogoutArgs;
    try {
      const resolved = await resolveActiveProfile(args.profile);
      if (resolved.kind === "none") {
        process.stdout.write("no profiles to log out — already clear\n");
        return;
      }
      if (resolved.kind === "ambiguous") {
        throw new AtoaError(
          `Multiple profiles configured (${resolved.names.join(", ")}). ` +
            "Pick one with `--profile <name>` or `atoa profile use <name>`.",
          "validation"
        );
      }

      const profile = resolved.profile;
      const profileName = resolved.name;

      const env = await pickEnv(profileName, profile, args.env);
      if (!profile.envs[env]) {
        process.stdout.write(`already cleared ${profileName}/${env}\n`);
        return;
      }

      // CLI is JWT-only — always the JWT logout path.
      await logoutJwt(profileName, env, args);
    } catch (err) {
      printError(err);
      process.exitCode = exitCodeFor((err as AtoaError).kind);
    }
  }
});

/** JWT mode logout: revoke refresh token server-side (best-effort), then clear JWT tokens locally. */
async function logoutJwt(profileName: string, env: Env, args: LogoutArgs): Promise<void> {
  if (args.dryRun) {
    const store = await createSecretsStore();
    const tokens = await store.getJwtTokens(profileName);
    const sdkToken = await store.get(profileName, env);
    process.stdout.write(
      JSON.stringify(
        {
          action: "logout",
          mode: "jwt",
          profile: profileName,
          env,
          willRevokeRefreshToken: !!tokens,
          willClearJwtTokens: true,
          willClearSdkToken: !!args.purgeKey && !!sdkToken
        },
        null,
        2
      ) + "\n"
    );
    return;
  }

  if (!args.yes) {
    const ok = await confirm({
      message: `Log out of ${env} for profile "${profileName}" (JWT session)?`
    });
    if (!ok) {
      process.stdout.write("Aborted.\n");
      return;
    }
  }

  const store = await createSecretsStore();
  const tokens = await store.getJwtTokens(profileName);

  // Best-effort server revoke — a failure does not block local cleanup.
  if (tokens) {
    try {
      assertTlsHardenedEnv();
      const http = buildHttpClient({
        baseUrl: resolveBaseUrl(),
        authHeader: "",
        verbose: false
      });
      await http.request({
        ...V1_ROUTES.auth.revoke,
        body: {refreshToken: tokens.refreshToken}
      });
      process.stdout.write(`✓ refresh token revoked on server\n`);
    } catch (err) {
      process.stderr.write(
        `  warning: server revoke failed: ${(err as Error).message} — proceeding with local cleanup\n`
      );
    }
  }

  await store.clearJwtTokens(profileName);

  if (args.purgeKey) {
    await store.delete(profileName, env);
    process.stdout.write(`✓ cleared JWT tokens and SDK token for ${profileName}/${env}\n`);
  } else {
    process.stdout.write(`✓ cleared JWT tokens for ${profileName}/${env}\n`);
  }

  await summariseProfileState(profileName);
}

/** SDK-paste mode logout: same as the original implementation. */
async function logoutSdkPaste(profileName: string, profile: ProfileConfig, env: Env, args: LogoutArgs): Promise<void> {
  if (args.dryRun) {
    const state = profile.envs[env];
    const remaining = (Object.keys(profile.envs) as Env[]).filter((e) => e !== env);
    process.stdout.write(
      JSON.stringify(
        {
          action: "logout",
          profile: profileName,
          env,
          willClearKeychainSlot: true,
          willClearConfigEntry: true,
          willRevokeServerSide: !!args.revoke && !!state?.sdkAccessId,
          sdkAccessId: state?.sdkAccessId ?? null,
          remainingEnvsAfter: remaining
        },
        null,
        2
      ) + "\n"
    );
    return;
  }

  if (!args.yes) {
    const ok = await confirm({
      message:
        `Log out of ${env} for profile "${profileName}"?` +
        (args.revoke ? ` (--revoke: also revokes the key server-side — affects other machines that share it)` : "")
    });
    if (!ok) {
      process.stdout.write("Aborted.\n");
      return;
    }
  }

  const store = await createSecretsStore();

  if (args.revoke) {
    await revokeOnServer(store, profileName, profile, env);
  }

  await clearEnv(store, profileName, env);
  await promoteSurvivorAsDefault(profileName, env);
  await summariseProfileState(profileName);
}

async function pickEnv(profileName: string, profile: ProfileConfig, explicit: string | undefined): Promise<Env> {
  if (explicit) return parseEnvFlag(explicit);

  const configured = (["sandbox", "production"] as Env[]).filter((e) => profile.envs[e] !== undefined);
  if (configured.length === 0) {
    throw new AtoaError(`profile "${profileName}" has no envs configured`, "validation");
  }
  if (configured.length === 1) return configured[0];

  if (!process.stdin.isTTY) {
    throw new AtoaError(
      `profile "${profileName}" has both sandbox and production keys — pass --env=sandbox|production to scope.`,
      "validation"
    );
  }

  return await select({
    message: `Profile "${profileName}" has both envs — select which env to log out of:`,
    choices: [
      {value: "sandbox", name: "sandbox"},
      {value: "production", name: "production"}
    ],
    default: profile.defaultEnv ?? "sandbox"
  });
}

/**
 * Drop the keychain slot + profile.envs[env] entry. If that was the last
 * env, remove the profile entry entirely so we don't leave an orphan record.
 */
async function clearEnv(store: SecretsStore, profileName: string, env: Env): Promise<void> {
  await store.delete(profileName, env);

  const profile = await readProfile(profileName);
  if (!profile) {
    process.stdout.write(`✓ cleared ${env} for "${profileName}" (${store.backend()})\n`);
    return;
  }

  const nextEnvs = {...profile.envs};
  delete nextEnvs[env];

  if (Object.keys(nextEnvs).length === 0) {
    // Last env gone → profile is now a dead shell. Sweep it up so the user
    // doesn't see an empty entry in `atoa profile list`.
    await store.deleteProfile(profileName);
    await deleteProfileEntry(profileName);
    process.stdout.write(`✓ cleared ${env} for "${profileName}" (${store.backend()})\n`);
    process.stdout.write(`  no envs remain — removing profile "${profileName}"\n`);
    return;
  }

  // Strip defaultEnv if it pointed at the env we just removed; the
  // promote-survivor step below will set a new one if applicable.
  const next: ProfileConfig = {
    ...profile,
    envs: nextEnvs,
    defaultEnv: profile.defaultEnv === env ? undefined : profile.defaultEnv
  };
  await writeProfile(profileName, next);
  process.stdout.write(`✓ cleared ${env} for "${profileName}" (${store.backend()})\n`);
}

/**
 * After clearing one env, if exactly one env still remains and it's not
 * already the recorded default, promote it. Users almost never want to keep
 * pointing `defaultEnv` at an env that no longer has credentials, and the
 * survivor is unambiguous when there's only one left.
 */
async function promoteSurvivorAsDefault(profileName: string, removedEnv: Env): Promise<void> {
  const profile = await readProfile(profileName);
  if (!profile) return; // profile already gone (last env was removed)

  const remaining = Object.keys(profile.envs) as Env[];
  if (remaining.length !== 1) return; // 0 → about to be deleted; 2 → nothing to promote

  const survivor = remaining[0];
  if (survivor === removedEnv) return; // shouldn't happen, defensive

  if (profile.defaultEnv === survivor) return; // already pointing at the survivor

  await writeProfile(profileName, {...profile, defaultEnv: survivor});
  process.stdout.write(`  defaultEnv now: ${survivor}\n`);
}

/**
 * One-line summary after the clear, mirroring the messages the old
 * `clearProfile` printed. Helps the user understand "what's my next move?"
 * without having to re-run `profile list`.
 */
async function summariseProfileState(profileName: string): Promise<void> {
  const cfg = await readConfig();
  const remaining = Object.keys(cfg.profiles);

  if (!remaining.includes(profileName) && remaining.length === 0) {
    process.stdout.write("  no profiles remain — run `atoa login` to pair this device again\n");
    return;
  }

  if (cfg.activeProfile === undefined) {
    if (remaining.length === 1) {
      // resolveActiveProfile will silently use the lone remaining profile; no UX bump needed.
      return;
    }
    process.stdout.write(
      `  active profile cleared — pick one with \`atoa profile use <name>\` (remaining: ${remaining.join(", ")})\n`
    );
  }
}

/**
 * Best-effort: call the revoke endpoint for the env we're about to log out
 * of. Keys with a recorded sdkAccessId are eligible; anything else gets a
 * notice and the local clear still runs.
 */
async function revokeOnServer(
  store: SecretsStore,
  profileName: string,
  profile: ProfileConfig,
  env: Env
): Promise<void> {
  const state = profile.envs[env];
  if (!state) return;

  if (!state.sdkAccessId) {
    process.stderr.write(`  skipping server revoke for ${env}: no sdkAccessId recorded. Use the dashboard.\n`);
    return;
  }

  const token = await store.get(profileName, env);
  if (!token) return;

  try {
    assertTlsHardenedEnv();
    const http = buildHttpClient({
      baseUrl: resolveBaseUrl(),
      authHeader: buildAuthHeader(token),
      verbose: false
    });
    await http.request({
      method: "DELETE",
      path: `/api/cli/api-access/${encodeURIComponent(state.sdkAccessId)}`
    });
    process.stdout.write(`✓ revoked ${env} on server (sdkAccessId: ${state.sdkAccessId})\n`);
  } catch (err) {
    process.stderr.write(
      `  warning: server revoke failed for ${env}: ${(err as Error).message} — proceeding with local clear\n`
    );
  }
}
