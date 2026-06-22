import {parseEnvFlag, resolveBaseUrl, type Env} from "./env";
import {buildAuthHeader, fingerprintToken} from "./auth";
import {latestSdkSecret, saveSdkKey} from "./sdk-key-file";
import {createSecretsStore} from "./secrets-store";
import {
  getActiveBusinessId,
  isProfileIncomplete,
  reconcileConfig,
  resolveActiveProfile,
  type ProfileConfig
} from "./config-store";
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
  /** True when the user passed --output explicitly (so list views stay JSON instead of going interactive). */
  formatExplicit: boolean;
  verbose: boolean;
  dryRun: boolean;
  yes: boolean;
  print(data: unknown): void;
  authFingerprint: string;
  profileName: string;
  profile: ProfileConfig;
}

export async function buildContext(
  opts: CommonOptions,
  flags: {allowIncomplete?: boolean} = {}
): Promise<CommandContext> {
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
  if (!flags.allowIncomplete && isProfileIncomplete(resolved.profile)) {
    throw new AtoaError(
      `profile "${resolved.name}" is incomplete (missing businessId). ` +
        `Re-pair via \`atoa login --profile ${resolved.name}\` or remove it with \`atoa logout --profile ${resolved.name}\`.`,
      "validation"
    );
  }

  const env = parseEnvFlag(opts.env ?? resolved.profile.defaultEnv);
  const format = resolveFormat(opts.output);
  const formatExplicit = opts.output !== undefined;
  const verbose = opts.verbose ?? false;
  const dryRun = opts.dryRun ?? false;
  const yes = opts.yes ?? false;

  const store = await createSecretsStore();

  // The CLI is JWT-only: every authenticated command uses the browser-login session
  // (access/refresh pair), supplied per-request by the http jwt seam below. SDK keys are
  // never stored by the CLI — they live in ~/atoa/auth/secret_key.json for the user/agent.
  const jwt = await store.getJwtTokens(resolved.name);
  if (!jwt) {
    throw new AtoaError(
      `No credentials for ${resolved.name}/${env}. Run: atoa login --profile ${resolved.name}`,
      "auth"
    );
  }
  const authHeader = "unused";
  const authFingerprint = "";

  // JWT session seam for `auth: "jwt"` requests (BUD-019). Bound to the
  // resolved profile + env so the HTTP layer stays store-agnostic.
  const profileName = resolved.name;
  const http = buildHttpClient({
    baseUrl: resolveBaseUrl(),
    authHeader,
    verbose,
    jwt: {
      getTokens: () => store.getJwtTokens(profileName),
      setTokens: (tokens) => store.setJwtTokens(profileName, tokens),
      clearTokens: () => store.clearJwtTokens(profileName),
      // Re-read per request (not a snapshot) so an `atoa business use` that
      // lands mid-process is picked up on the next request.
      getActiveBusinessId: () => getActiveBusinessId(profileName)
    }
  });

  return {
    env,
    http,
    format,
    formatExplicit,
    verbose,
    dryRun,
    yes,
    authFingerprint,
    profileName: resolved.name,
    profile: resolved.profile,
    print: (data) => print(data, format)
  };
}

/**
 * Guard for the SDK-key commands: returns the SDK bearer for `env`, prompting for and storing one
 * if none exists. The key is kept ONLY in ~/atoa/auth/secret_key.json (never the OS keychain).
 */
export async function ensureSdkKey(env: Env): Promise<string> {
  const existing = await latestSdkSecret(env);
  if (existing) return existing;

  if (!process.stdout.isTTY) {
    throw new AtoaError(
      `No Atoa API key stored for ${env}. Run \`atoa keys create --env ${env}\` (or paste one interactively in a terminal), then retry.`,
      "auth"
    );
  }

  const {password} = await import("@inquirer/prompts");
  const key = (await password({message: `Paste your Atoa ${env} API key:`, mask: "*"})).trim();
  if (!key) throw new AtoaError("API key cannot be empty", "validation");

  const savedTo = await saveSdkKey({
    env,
    sdkAccessId: null,
    apiSecret: key,
    profile: "sdk",
    createdAt: new Date().toISOString()
  });
  process.stderr.write(`✓ API key stored at ${savedTo}\n`);
  return key;
}

/**
 * Context for the SDK-key commands (customers, payments, refunds, …). Unlike buildContext it does
 * NOT require a JWT login — it authenticates with the stored SDK key (file-based, no keychain),
 * prompting for one via ensureSdkKey when missing. dry-run skips the key entirely (no request sent).
 */
export async function buildSdkContext(opts: CommonOptions): Promise<CommandContext> {
  assertTlsHardenedEnv();

  const env = parseEnvFlag(opts.env ?? "production");
  const format = resolveFormat(opts.output);
  const formatExplicit = opts.output !== undefined;
  const verbose = opts.verbose ?? false;
  const dryRun = opts.dryRun ?? false;
  const yes = opts.yes ?? false;

  let authHeader = "unused";
  let authFingerprint = "";
  if (!dryRun) {
    const key = await ensureSdkKey(env);
    authHeader = buildAuthHeader(key);
    authFingerprint = fingerprintToken(key);
  }

  const http = buildHttpClient({baseUrl: resolveBaseUrl(), authHeader, verbose});

  return {
    env,
    http,
    format,
    formatExplicit,
    verbose,
    dryRun,
    yes,
    authFingerprint,
    profileName: "sdk",
    profile: {businessId: "", displayName: "SDK", defaultEnv: env, envs: {}},
    print: (data) => print(data, format)
  };
}
