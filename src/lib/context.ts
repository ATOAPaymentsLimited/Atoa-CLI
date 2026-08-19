/* eslint-disable max-lines-per-function */
import {parseEnvFlag, resolveBaseUrl, type Env} from "./env";
import {buildAuthHeader, fingerprintToken} from "./auth";
import {latestSdkSecret} from "./sdk-key-file";
import {createSecretsStore} from "./secrets-store";
import {
  getActiveBusinessId,
  isProfileIncomplete,
  reconcileConfig,
  resolveActiveProfile,
  readProfile,
  writeProfile,
  type ProfileConfig
} from "./config-store";
import {normalizeBusinesses, type BusinessSummary} from "./businesses";
import {V1_ROUTES} from "./v1-routes";
import {buildHttpClient, assertTlsHardenedEnv, type HttpClient} from "./http";
import {resolveFormat, print, type OutputFormat} from "./output";
import {AtoaError} from "./errors";
import {t} from "./i18n";

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
    throw new AtoaError(t("noProfileConfigured"), "auth");
  }
  if (resolved.kind === "ambiguous") {
    throw new AtoaError(
      `Multiple profiles are configured (${resolved.names.join(", ")}). ` +
        "Run `atoa profile use <name>` to set the active profile, or override per-command with `--profile <name>` or `ATOA_PROFILE=<name>`.",
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
    // No session AND no business means `signup` wrote the profile and never got further — a
    // stub, not a usable profile. Saying so beats "run login", which re-pairs a profile the
    // user probably never meant to keep.
    const stub = isProfileIncomplete(resolved.profile);
    throw new AtoaError(
      stub
        ? `Profile "${resolved.name}" was never finished — it has no session and no business. ` +
          `Continue onboarding with \`atoa signup\`, or drop it with \`atoa logout --profile ${resolved.name}\`.`
        : `No credentials for ${resolved.name}. Run: atoa login --profile ${resolved.name}`,
      "auth"
    );
  }
  const authHeader = "unused";
  const authFingerprint = "";

  // JWT session seam for `auth: "jwt"` requests. Bound to the
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

  // A profile with no businessId is recoverable, not fatal: `signup` writes the profile as soon
  // as the account exists but only fills the business in once one has been created, so an
  // interrupted onboarding leaves this gap. The JWT session is still valid, so the business can
  // simply be looked up and written back — telling the user to log out and in again would
  // discard a working session to fix a field the server already knows.
  let profile = resolved.profile;
  if (!flags.allowIncomplete && isProfileIncomplete(profile)) {
    profile = await adoptBusiness(http, resolved.name);
  }

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
    profile,
    print: (data) => print(data, format)
  };
}

/**
 * Fills in a profile's missing businessId from the account's own businesses, and persists it so
 * the lookup happens once rather than on every command.
 *
 * Only an unambiguous account is adopted silently. With several businesses the CLI cannot know
 * which one was meant, and with none there is nothing to adopt — both say so instead of guessing.
 */
async function adoptBusiness(http: HttpClient, profileName: string): Promise<ProfileConfig> {
  let businesses: BusinessSummary[];
  try {
    const {data} = await http.request({...V1_ROUTES.businesses.list});
    businesses = normalizeBusinesses(data);
  } catch {
    throw new AtoaError(
      `profile "${profileName}" has no business set, and the business list could not be reached. ` +
        `Check your connection, or re-pair with \`atoa login --profile ${profileName}\`.`,
      "network"
    );
  }

  if (businesses.length === 0) {
    throw new AtoaError(
      `profile "${profileName}" has no business yet. Finish onboarding with \`atoa signup\`.`,
      "validation"
    );
  }
  if (businesses.length > 1) {
    const names = businesses.map((b) => `  ${b.id}  ${b.legalBusinessName || "(unnamed)"}`).join("\n");
    throw new AtoaError(
      `profile "${profileName}" has no business set and this account has ${businesses.length}:\n${names}\n` +
        "Pick one with `atoa business use <id>`.",
      "business_selection"
    );
  }

  const {id, legalBusinessName} = businesses[0];
  await writeProfile(profileName, {businessId: id, activeBusinessId: id});
  process.stderr.write(`Resumed profile "${profileName}" on business ${legalBusinessName || id}.\n`);

  const updated = await readProfile(profileName);
  if (!updated) throw new AtoaError(`profile "${profileName}" disappeared while being repaired.`, "generic");
  return updated;
}

/**
 * Guard for the SDK-key commands: returns the stored SDK bearer for `env`. SDK keys must be
 * minted explicitly (`atoa keys create`) so they always carry a
 * revocable sdkAccessId. There is deliberately NO paste-and-store fallback — pasting a raw secret
 * would persist an un-revocable plaintext key (no sdkAccessId for `atoa keys revoke` to target).
 * The key is kept ONLY in ~/.atoa/auth/secret_key.json (never the OS keychain).
 */
export async function ensureSdkKey(env: Env): Promise<string> {
  const existing = await latestSdkSecret(env);
  if (existing) return existing;

  throw new AtoaError(
    `No Atoa API key stored for ${env}. Mint a revocable one with \`atoa keys create --env ${env}\`, then retry.`,
    "auth"
  );
}

/**
 * Context for the SDK-key commands (customers, payments, refunds, …). Unlike buildContext it does
 * NOT require a JWT login — it authenticates with the stored SDK key (file-based, no keychain).
 * Errors via ensureSdkKey when no key is stored. dry-run skips the key entirely (no request sent).
 */
export async function buildSdkContext(opts: CommonOptions): Promise<CommandContext> {
  assertTlsHardenedEnv();

  const env = parseEnvFlag(opts.env ?? "sandbox");
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
