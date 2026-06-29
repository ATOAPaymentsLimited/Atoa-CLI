import {promises as fs} from "fs";
import {join} from "path";
import {authDir, ensureAuthDirSecure} from "./secrets-store";

/**
 * SDK keys are written to a plain JSON file at ~/.atoa/auth/secret_key.json (owner-only, 0600)
 * rather than the OS keychain — so an external coding agent can read the secret to use as the
 * SDK bearer for `get`/`post`/`delete` calls. The file holds an array under `keys`.
 */
export interface SdkKeyRecord {
  env: string;
  sdkAccessId: string | null;
  apiSecret: string;
  profile: string;
  createdAt: string;
}

export function sdkKeyFilePath(): string {
  return join(authDir(), "secret_key.json");
}

async function readAll(): Promise<SdkKeyRecord[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(sdkKeyFilePath(), "utf8"));
    return Array.isArray(parsed?.keys) ? (parsed.keys as SdkKeyRecord[]) : [];
  } catch {
    return [];
  }
}

async function writeAll(keys: SdkKeyRecord[]): Promise<string> {
  const fp = sdkKeyFilePath();
  await ensureAuthDirSecure();
  await fs.writeFile(fp, JSON.stringify({keys}, null, 2) + "\n", {mode: 0o600});
  if (process.platform !== "win32") await fs.chmod(fp, 0o600).catch(() => undefined);
  return fp;
}

/** Persist a created/rotated SDK key (replacing any entry with the same sdkAccessId). Returns the file path. */
export async function saveSdkKey(record: SdkKeyRecord): Promise<string> {
  const keys = (await readAll()).filter((k) => !(record.sdkAccessId && k.sdkAccessId === record.sdkAccessId));
  keys.push(record);
  return writeAll(keys);
}

/** Remove a key entry by sdkAccessId. Returns the file path, or null if there was nothing stored. */
export async function removeSdkKey(sdkAccessId: string): Promise<string | null> {
  const keys = await readAll();
  if (keys.length === 0) return null;
  return writeAll(keys.filter((k) => k.sdkAccessId !== sdkAccessId));
}

/** Remove every key entry for a profile+env (logout --purge-key --env). Returns the file path, or null if nothing matched. */
export async function removeSdkKeysFor(profile: string, env: string): Promise<string | null> {
  const keys = await readAll();
  const remaining = keys.filter((k) => !(k.profile === profile && k.env === env));
  if (remaining.length === keys.length) return null;
  return writeAll(remaining);
}

/** Remove every key entry for a profile across all envs (logout --purge-key, no --env). Returns the file path, or null if nothing matched. */
export async function removeSdkKeysForProfile(profile: string): Promise<string | null> {
  const keys = await readAll();
  const remaining = keys.filter((k) => k.profile !== profile);
  if (remaining.length === keys.length) return null;
  return writeAll(remaining);
}

/** True if any stored SDK key belongs to this profile (any env). */
export async function hasSdkKeysForProfile(profile: string): Promise<boolean> {
  return (await readAll()).some((k) => k.profile === profile);
}

/** True if any stored SDK key matches this profile+env. Read-only — for dry-run previews. */
export async function hasSdkKeyFor(profile: string, env: string): Promise<boolean> {
  return (await readAll()).some((k) => k.profile === profile && k.env === env);
}

/** Find a stored key by sdkAccessId — e.g. to read its env before revoking. */
export async function findSdkKey(sdkAccessId: string): Promise<SdkKeyRecord | undefined> {
  return (await readAll()).find((k) => k.sdkAccessId === sdkAccessId);
}

/** Most-recently-stored sdkAccessId for an env — used when the command isn't given one explicitly. */
export async function latestSdkAccessId(env: string): Promise<string | undefined> {
  const forEnv = (await readAll()).filter((k) => k.env === env && k.sdkAccessId);
  return forEnv.length ? (forEnv[forEnv.length - 1].sdkAccessId as string) : undefined;
}

/** Most-recently-stored apiSecret (bearer) for an env — the SDK commands' guard uses this. */
export async function latestSdkSecret(env: string): Promise<string | undefined> {
  const forEnv = (await readAll()).filter((k) => k.env === env && k.apiSecret);
  return forEnv.length ? forEnv[forEnv.length - 1].apiSecret : undefined;
}
