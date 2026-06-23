import {promises as fs} from "fs";
import {hostname} from "os";
import {join} from "path";
import {configHomeDir, createSecretsStore} from "./secrets-store";

export type Env = "sandbox" | "production";

export interface EnvState {
  tokenFingerprint: string;
  /** Opaque identifier for the SDK access key. Used by the revoke/regenerate endpoints. */
  sdkAccessId?: string;
  /** Whether this profile+env uses JWT browser login or the legacy SDK paste flow. */
  authMode?: "jwt" | "sdk-paste";
}

export interface ProfileConfig {
  businessId: string;
  displayName: string;
  defaultEnv?: Env;
  envs: Partial<Record<Env, EnvState>>;
  /** The business ID that was last selected/active in the dashboard for this profile. */
  activeBusinessId?: string;
  /**
   * Per-profile programmatic device id sent at login. Distinct per profile so the backend
   * (which keys CLI JWTs by userId+source+deviceId and evicts the prior token on each login)
   * gives every business-profile its OWN session slot — logging into one profile no longer
   * expires another profile of the same user. Falls back to a fresh id when absent.
   */
  clientDeviceId?: string;
}

export interface AtoaConfig {
  /** Bumps when ProfileConfig or top-level shape changes. */
  schemaVersion: 1;
  activeProfile?: string;
  profiles: Record<string, ProfileConfig>;
}

export const CURRENT_SCHEMA_VERSION = 1 as const;

export function configFilePath(): string {
  return join(configHomeDir(), ".config", "atoa", "config.json");
}

/**
 * Default-shaped empty config. Used when the file doesn't exist yet so callers
 * always get a fully-populated config with the current schema version.
 */
function emptyConfig(): AtoaConfig {
  return {schemaVersion: CURRENT_SCHEMA_VERSION, profiles: {}};
}

/**
 * Reads ~/.config/atoa/config.json. Returns an empty (but fully-shaped) config
 * when the file is missing. Surfaces JSON parse errors with a friendly hint
 * pointing at the file path so users can fix or `atoa reset`.
 */
export async function readConfig(): Promise<AtoaConfig> {
  let raw: string;
  try {
    raw = await fs.readFile(configFilePath(), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyConfig();
    throw err;
  }
  let parsed: Partial<AtoaConfig>;
  try {
    parsed = JSON.parse(raw) as Partial<AtoaConfig>;
  } catch (err) {
    const fp = configFilePath();
    throw new Error(
      `${fp} contains invalid JSON: ${(err as Error).message}. ` +
        `Fix the file manually or run \`atoa reset\` to start over.`
    );
  }

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    activeProfile: parsed.activeProfile,
    profiles: normalizeProfiles(parsed.profiles ?? {})
  };
}

function normalizeProfiles(profiles: Record<string, Partial<ProfileConfig>>): Record<string, ProfileConfig> {
  const out: Record<string, ProfileConfig> = {};
  for (const [name, raw] of Object.entries(profiles)) {
    out[name] = {
      businessId: raw.businessId ?? "",
      displayName: raw.displayName ?? name,
      defaultEnv: raw.defaultEnv,
      envs: raw.envs ?? {},
      activeBusinessId: raw.activeBusinessId,
      clientDeviceId: raw.clientDeviceId
    };
  }
  return out;
}

/** True when a profile lacks fields required for non-trivial operations. */
export function isProfileIncomplete(profile: ProfileConfig): boolean {
  return !profile.businessId;
}

/**
 * Throws a user-facing AtoaError-style Error when a profile is missing fields
 * needed for API calls. Call this at the top of any command that talks to the
 * API — keeps the failure mode predictable instead of surfacing as a cryptic
 * `Cannot read properties of undefined`.
 */
export function assertProfileComplete(name: string, profile: ProfileConfig): void {
  if (isProfileIncomplete(profile)) {
    throw new Error(
      `profile "${name}" is incomplete (missing businessId). ` +
        "Re-pair via `atoa login` or remove it with `atoa logout --profile " +
        name +
        "`."
    );
  }
}

export async function writeConfig(config: AtoaConfig): Promise<void> {
  const fp = configFilePath();
  const dir = join(fp, "..");
  await fs.mkdir(dir, {recursive: true, mode: 0o700});
  await fs.writeFile(fp, JSON.stringify(config, null, 2) + "\n", {encoding: "utf8", mode: 0o600});
}

// ---- Profile helpers ------------------------------------------------------

export async function readProfile(name: string): Promise<ProfileConfig | undefined> {
  const cfg = await readConfig();
  return cfg.profiles[name];
}

/**
 * Write a profile entry. Accepts partial input — defaults are filled the same
 * way `readConfig` normalizes (so callers can update one field without having
 * to reconstruct the full shape).
 */
export async function writeProfile(
  name: string,
  profile: Partial<ProfileConfig> & {businessId: string}
): Promise<void> {
  const cfg = await readConfig();
  const existing = cfg.profiles[name];
  const next: ProfileConfig = {
    businessId: profile.businessId,
    displayName: profile.displayName ?? name,
    defaultEnv: profile.defaultEnv,
    envs: profile.envs ?? {},
    // Preserve sticky per-profile fields when a caller doesn't supply them, so a plain
    // profile write never wipes the active business or the device id.
    activeBusinessId: profile.activeBusinessId ?? existing?.activeBusinessId,
    clientDeviceId: profile.clientDeviceId ?? existing?.clientDeviceId
  };
  cfg.profiles = {...cfg.profiles, [name]: next};
  await writeConfig(cfg);
}

export async function deleteProfile(name: string): Promise<boolean> {
  const cfg = await readConfig();
  if (!(name in cfg.profiles)) return false;
  const next = {...cfg.profiles};
  delete next[name];
  cfg.profiles = next;
  if (cfg.activeProfile === name) delete cfg.activeProfile;
  await writeConfig(cfg);
  return true;
}

export async function listProfiles(): Promise<Record<string, ProfileConfig>> {
  const cfg = await readConfig();
  return cfg.profiles;
}

export async function setActiveProfile(name: string | undefined): Promise<void> {
  const cfg = await readConfig();
  if (name === undefined) {
    delete cfg.activeProfile;
  } else {
    if (!cfg.profiles[name]) {
      throw new Error(`No profile named "${name}". Run \`atoa profile list\` to see available profiles.`);
    }
    cfg.activeProfile = name;
  }
  await writeConfig(cfg);
}

export type ResolvedProfile =
  | {kind: "ok"; name: string; profile: ProfileConfig}
  | {kind: "none"}
  | {kind: "ambiguous"; names: string[]};

/**
 * Implements the profile resolution chain:
 *
 *   --profile flag
 *     → $ATOA_PROFILE env var
 *       → config.activeProfile
 *         → only profile if exactly one exists (silent)
 *           → ambiguous (caller errors with the list of names)
 */
export async function resolveActiveProfile(flagProfile?: string): Promise<ResolvedProfile> {
  const cfg = await readConfig();
  const profiles = cfg.profiles;

  const candidate = flagProfile?.trim() || process.env.ATOA_PROFILE?.trim() || cfg.activeProfile;

  if (candidate) {
    const found = profiles[candidate];
    if (!found) {
      throw new Error(`No profile named "${candidate}". Run \`atoa profile list\` to see available profiles.`);
    }
    return {kind: "ok", name: candidate, profile: found};
  }

  const names = Object.keys(profiles);
  if (names.length === 0) return {kind: "none"};
  if (names.length === 1) return {kind: "ok", name: names[0], profile: profiles[names[0]]};
  return {kind: "ambiguous", names};
}

/**
 * Builds a fresh ProfileConfig. Use this when creating a new profile so the
 * shape stays consistent (especially that `envs` defaults to {} rather than
 * being missing, which would crash downstream readers).
 */
export function newProfile(opts: {businessId: string; displayName: string; defaultEnv?: Env}): ProfileConfig {
  return {
    businessId: opts.businessId,
    displayName: opts.displayName,
    defaultEnv: opts.defaultEnv,
    envs: {}
  };
}

/**
 * Self-heals a dangling activeProfile pointer that points at a deleted profile.
 * Returns true if the config was modified. Called from `buildContext` at the
 * top of every command so the user is never stuck in a broken state.
 */
export async function reconcileConfig(): Promise<boolean> {
  const cfg = await readConfig();
  if (cfg.activeProfile && !cfg.profiles[cfg.activeProfile]) {
    process.stderr.write(`note: activeProfile "${cfg.activeProfile}" is missing from config — clearing.\n`);
    delete cfg.activeProfile;
    await writeConfig(cfg);
    return true;
  }
  return false;
}

/**
 * Slugifies a business name into a profile slug. Empty results fall back to a
 * stable per-business slug so we never produce `""`.
 */
export function slugifyBusinessName(businessName: string | undefined, businessId: string): string {
  const raw = (businessName ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (raw) return raw;
  return `business-${
    businessId
      .replace(/[^a-z0-9]/gi, "")
      .slice(-6)
      .toLowerCase() || "unknown"
  }`;
}

/**
 * Resolves a profile name for a newly-logged-in business. Honours an explicit
 * `--profile` override and otherwise derives from `businessName`, appending a
 * `-<last6 of businessId>` suffix on collisions with a *different* business.
 */
export async function deriveProfileName(opts: {
  explicit?: string;
  businessName?: string;
  businessId: string;
}): Promise<string> {
  if (opts.explicit?.trim()) return opts.explicit.trim();

  const base = slugifyBusinessName(opts.businessName, opts.businessId);
  const existing = (await readConfig()).profiles;

  const inUseBy = existing[base]?.businessId;
  if (!inUseBy || inUseBy === opts.businessId) return base;

  const suffix = opts.businessId
    .replace(/[^a-z0-9]/gi, "")
    .slice(-6)
    .toLowerCase();
  const candidate = suffix ? `${base}-${suffix}` : base;
  const candidateInUseBy = existing[candidate]?.businessId;
  if (!candidateInUseBy || candidateInUseBy === opts.businessId) return candidate;

  throw new Error(
    `Profile name collision: both "${base}" and "${candidate}" are taken by other businesses. ` +
      `Pass --profile <name> to choose explicitly.`
  );
}

// ---- Device identity ---------------------------------------------------------

/**
 * Returns `os.hostname()` truncated to 64 chars. Falls back to "atoa-cli"
 * when the hostname is empty (e.g., containers with a blank /etc/hostname).
 */
export function getDeviceName(): string {
  const name = hostname().slice(0, 64);
  return name || "atoa-cli";
}

// ---- Per-profile activeBusinessId -------------------------------------------

/**
 * Returns the stored `activeBusinessId` for the given profile, or `undefined`
 * if the profile doesn't exist or the field has not been set.
 */
export async function getActiveBusinessId(profileName: string): Promise<string | undefined> {
  const cfg = await readConfig();
  return cfg.profiles[profileName]?.activeBusinessId;
}

/**
 * Persists `activeBusinessId` on the given profile. Throws if the profile
 * doesn't exist so callers fail fast with a clear message.
 */
export async function setActiveBusinessId(profileName: string, businessId: string): Promise<void> {
  const cfg = await readConfig();
  if (!cfg.profiles[profileName]) {
    throw new Error(`No profile named "${profileName}". Run \`atoa profile list\` to see available profiles.`);
  }
  cfg.profiles[profileName].activeBusinessId = businessId;
  await writeConfig(cfg);
}

/**
 * Renames a profile — used after signup to make the profile name match the new business slug.
 * The profile name keys both the config entry AND the secret-store slots, so this moves the JWT
 * secret to the new slot, carries the env session metadata over, points the entry at the new
 * business, repoints `activeProfile`, and removes the old entry. Only JWT (browser-login) secrets
 * are moved — that's all signup produces. If oldName === newName it just applies the updates.
 */
export async function renameProfile(
  oldName: string,
  newName: string,
  updates: {businessId: string; displayName: string}
): Promise<void> {
  const cfg = await readConfig();
  const existing = cfg.profiles[oldName];
  if (!existing) throw new Error(`No profile named "${oldName}".`);

  if (oldName === newName) {
    cfg.profiles[oldName] = {
      ...existing,
      businessId: updates.businessId,
      displayName: updates.displayName,
      activeBusinessId: updates.businessId
    };
    await writeConfig(cfg);
    return;
  }
  if (cfg.profiles[newName]) {
    throw new Error(`Cannot rename to "${newName}" — a profile with that name already exists.`);
  }

  // Move the JWT session (env-independent, keyed by profile name) from old to new.
  const store = await createSecretsStore();
  const jwt = await store.getJwtTokens(oldName);
  if (jwt) await store.setJwtTokens(newName, jwt);

  cfg.profiles[newName] = {
    ...existing,
    businessId: updates.businessId,
    displayName: updates.displayName,
    activeBusinessId: updates.businessId
  };
  delete cfg.profiles[oldName];
  if (cfg.activeProfile === oldName) cfg.activeProfile = newName;
  await writeConfig(cfg);

  // Clear the old session only after the config no longer points at it.
  await store.clearJwtTokens(oldName);
}

// ---- Per-profile-per-env authMode -------------------------------------------

/**
 * Returns the `authMode` for the given profile + env. When the field is absent
 * (legacy config), returns `"sdk-paste"` so existing callers are unaffected.
 */
export async function getAuthMode(profileName: string, env: Env): Promise<"jwt" | "sdk-paste"> {
  const cfg = await readConfig();
  return cfg.profiles[profileName]?.envs[env]?.authMode ?? "sdk-paste";
}

/**
 * Persists `authMode` for the given profile + env. Throws if the profile
 * doesn't exist.
 */
export async function setAuthMode(profileName: string, env: Env, mode: "jwt" | "sdk-paste"): Promise<void> {
  const cfg = await readConfig();
  if (!cfg.profiles[profileName]) {
    throw new Error(`No profile named "${profileName}". Run \`atoa profile list\` to see available profiles.`);
  }
  const existing = cfg.profiles[profileName].envs[env] ?? {tokenFingerprint: ""};
  cfg.profiles[profileName].envs[env] = {...existing, authMode: mode};
  await writeConfig(cfg);
}
