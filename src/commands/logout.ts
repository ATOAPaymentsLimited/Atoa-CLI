import {defineCommand} from "citty";
import {confirm} from "@inquirer/prompts";
import {parseEnvFlag, resolveBaseUrl, type Env} from "../lib/env";
import {buildHttpClient, assertTlsHardenedEnv} from "../lib/http";
import {createSecretsStore} from "../lib/secrets-store";
import {readConfig, resolveActiveProfile} from "../lib/config-store";
import {AtoaError, printError, exitCodeFor} from "../lib/errors";
import {LOCAL_DRY_RUN_ARG} from "./_common";
import {V1_ROUTES} from "../lib/v1-routes";
import {removeSdkKeysFor, removeSdkKeysForProfile, hasSdkKeyFor, hasSdkKeysForProfile} from "../lib/sdk-key-file";

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
    description: "Log out of a profile: clear its browser (JWT) session, optionally purging stored SDK keys."
  },
  args: {
    profile: {type: "string", description: "profile to log out from (defaults to active profile)"},
    revoke: {
      type: "boolean",
      description: "(always on) best-effort server revoke of the refresh token; kept for script compatibility"
    },
    purgeKey: {
      type: "boolean",
      description: "also remove the profile's stored SDK API key(s) from secret_key.json"
    },
    env: {
      type: "string",
      description: "scope --purge-key to one env (sandbox|production); omit to purge every env's SDK key"
    },
    yes: {type: "boolean", description: "skip the confirm prompt"},
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

      await logoutJwt(resolved.name, args);
    } catch (err) {
      printError(err);
      process.exitCode = exitCodeFor((err as AtoaError).kind);
    }
  }
});

/**
 * Logs out a profile. The browser JWT session is env-independent (one pair per profile), so logout
 * clears it wholesale — no env to pick. `--purge-key` also removes the profile's per-env SDK keys
 * (every env, or just the one named by `--env`). The server-side refresh-token revoke is
 * best-effort and never blocks local cleanup.
 */
async function logoutJwt(profileName: string, args: LogoutArgs): Promise<void> {
  const purgeEnv: Env | undefined = args.env ? parseEnvFlag(args.env) : undefined;
  const store = await createSecretsStore();
  const tokens = await store.getJwtTokens(profileName);

  const sdkKeyPresent = args.purgeKey
    ? purgeEnv
      ? await hasSdkKeyFor(profileName, purgeEnv)
      : await hasSdkKeysForProfile(profileName)
    : false;

  if (!tokens && !sdkKeyPresent) {
    process.stdout.write(`already logged out — nothing to clear for "${profileName}"\n`);
    return;
  }

  if (args.dryRun) {
    process.stdout.write(
      JSON.stringify(
        {
          action: "logout",
          profile: profileName,
          willRevokeRefreshToken: !!tokens,
          willClearJwtTokens: !!tokens,
          willClearSdkKeys: sdkKeyPresent,
          sdkKeyScope: args.purgeKey ? (purgeEnv ?? "all") : null
        },
        null,
        2
      ) + "\n"
    );
    return;
  }

  if (!args.yes) {
    const ok = await confirm({message: `Log out of profile "${profileName}" (clear its JWT session)?`});
    if (!ok) {
      process.stdout.write("Aborted.\n");
      return;
    }
  }

  // Best-effort server revoke, then clear the (env-independent) JWT session.
  if (tokens) {
    try {
      assertTlsHardenedEnv();
      const http = buildHttpClient({baseUrl: resolveBaseUrl(), authHeader: "", verbose: false});
      await http.request({...V1_ROUTES.auth.revoke, body: {refreshToken: tokens.refreshToken}});
      process.stdout.write(`✓ refresh token revoked on server\n`);
    } catch (err) {
      process.stderr.write(
        `  warning: server revoke failed: ${(err as Error).message} — proceeding with local cleanup\n`
      );
    }
    await store.clearJwtTokens(profileName);
    process.stdout.write(`✓ cleared JWT session for "${profileName}"\n`);
  }

  if (args.purgeKey) {
    const removed = purgeEnv
      ? await removeSdkKeysFor(profileName, purgeEnv)
      : await removeSdkKeysForProfile(profileName);
    const scope = purgeEnv ? `${profileName}/${purgeEnv}` : `${profileName} (all envs)`;
    process.stdout.write(removed ? `✓ removed SDK key(s) for ${scope}\n` : `  no SDK key stored for ${scope}\n`);
  }

  await summariseProfileState(profileName);
}

/**
 * One-line summary after the clear, helping the user understand "what's my next move?"
 * without having to re-run `profile list`.
 */
async function summariseProfileState(profileName: string): Promise<void> {
  const cfg = await readConfig();
  const remaining = Object.keys(cfg.profiles);

  if (!remaining.includes(profileName) && remaining.length === 0) {
    process.stdout.write("  no profiles remain — run `atoa login` to pair this device again\n");
    return;
  }

  if (cfg.activeProfile === undefined && remaining.length > 1) {
    process.stdout.write(
      `  active profile cleared — pick one with \`atoa profile use <name>\` (remaining: ${remaining.join(", ")})\n`
    );
  }
}
