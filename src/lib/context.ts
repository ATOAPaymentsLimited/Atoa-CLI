import {parseEnvFlag, resolveBaseUrl, type Env} from "./env";
import {buildAuthHeader, fingerprintToken} from "./auth";
import {createSecretsStore} from "./secrets-store";
import {isProfileIncomplete, reconcileConfig, resolveActiveProfile, type ProfileConfig} from "./config-store";
import {buildHttpClient, assertTlsHardenedEnv, type HttpClient} from "./http";
import {resolveFormat, print, type OutputFormat} from "./output";
import {AtoaError} from "./errors";

export type {Env, OutputFormat, HttpClient};

export interface CommonOptions {
  env?: string;
  output?: string;
  verbose?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  profile?: string;
}

export interface CommandContext {
  env: Env;
  http: HttpClient;
  format: OutputFormat;
  verbose: boolean;
  dryRun: boolean;
  yes: boolean;
  print(data: unknown): void;
  authFingerprint: string;
  profileName: string;
  profile: ProfileConfig;
}

export async function buildContext(opts: CommonOptions): Promise<CommandContext> {
  assertTlsHardenedEnv();

  // Self-heal a dangling activeProfile pointer (e.g. user manually deleted a
  // profile entry but the pointer still references it). One-shot, idempotent.
  await reconcileConfig();

  const resolved = await resolveActiveProfile(opts.profile);
  if (resolved.kind === "none") {
    throw new AtoaError("No profile is configured. Run `atoa login` to pair this device.", "auth");
  }
  if (resolved.kind === "ambiguous") {
    throw new AtoaError(
      `Multiple profiles are configured (${resolved.names.join(", ")}). ` +
        "Run `atoa profile use <name>` to set the active profile, or override per-command with `--profile <name>` or `ATOA_PROFILE=<name>`.",
      "validation"
    );
  }

  // Refuse to run commands against a profile that's missing required local
  // fields (today: businessId). A corrupted / hand-edited entry should fail
  // loudly with an actionable message, not crash deep in code.
  if (isProfileIncomplete(resolved.profile)) {
    throw new AtoaError(
      `profile "${resolved.name}" is incomplete (missing businessId). ` +
        `Re-pair via \`atoa login --profile ${resolved.name}\` or remove it with \`atoa logout --profile ${resolved.name}\`.`,
      "validation"
    );
  }

  const env = parseEnvFlag(opts.env ?? resolved.profile.defaultEnv);
  const format = resolveFormat(opts.output);
  const verbose = opts.verbose ?? false;
  const dryRun = opts.dryRun ?? false;
  const yes = opts.yes ?? false;

  const store = await createSecretsStore();
  const token = await store.get(resolved.name, env);
  if (!token) {
    throw new AtoaError(
      `No credentials for ${resolved.name}/${env}. Run: atoa login --profile ${resolved.name}`,
      "auth"
    );
  }

  const authHeader = buildAuthHeader(token);
  const authFingerprint = fingerprintToken(token);
  const http = buildHttpClient({baseUrl: resolveBaseUrl(), authHeader, verbose});

  return {
    env,
    http,
    format,
    verbose,
    dryRun,
    yes,
    authFingerprint,
    profileName: resolved.name,
    profile: resolved.profile,
    print: (data) => print(data, format)
  };
}
