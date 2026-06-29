import {promises as fs} from "fs";
import {spawn} from "node:child_process";
import {homedir, userInfo} from "os";
import {join} from "path";

export type SecretsEnv = "sandbox" | "production";

export interface JwtTokens {
  accessToken: string;
  refreshToken: string;
}

export interface SecretsStore {
  get(profile: string, env: SecretsEnv): Promise<string | undefined>;
  set(profile: string, env: SecretsEnv, token: string): Promise<void>;
  delete(profile: string, env: SecretsEnv): Promise<void>;
  deleteProfile(profile: string): Promise<void>;
  backend(): "system" | "file";
  /**
   * Store the JWT credential pair for a profile. JWT sessions are env-INDEPENDENT
   * (the auth backend is the same for sandbox/production), so they're keyed
   * by profile only — unlike SDK keys, which are per-env (see sdk-key-file.ts).
   */
  setJwtTokens(profile: string, tokens: JwtTokens): Promise<void>;
  /** Retrieve the JWT credential pair. Returns null when either half is missing. */
  getJwtTokens(profile: string): Promise<JwtTokens | null>;
  /** Remove the JWT session for a profile. */
  clearJwtTokens(profile: string): Promise<void>;
}

export function configHomeDir(): string {
  return process.env.ATOA_HOME ?? homedir();
}

/** ~/.atoa/auth — the (hidden) directory holding all CLI credential files (session + SDK keys). */
export function authDir(): string {
  return join(configHomeDir(), ".atoa", "auth");
}

/** JWT session store. Plain file (no OS keychain) so external agents can read it; 0600. */
export function sessionFilePath(): string {
  return join(authDir(), "session.json");
}

interface SessionFile {
  sessions: Record<string, JwtTokens>;
}

async function readSessionFile(): Promise<SessionFile> {
  const fp = sessionFilePath();
  let raw: string;
  try {
    const st = await fs.stat(fp);
    if (process.platform !== "win32" && st.mode & 0o077) {
      throw new Error(
        `Refusing to read ${fp}: insecure permissions (mode ${(st.mode & 0o777).toString(8)}). Run: chmod 600 "${fp}"`
      );
    }
    raw = await fs.readFile(fp, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {sessions: {}};
    throw err;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<SessionFile>;
    return {sessions: parsed.sessions ?? {}};
  } catch {
    throw new Error(
      `Refusing to parse ${fp}: not valid JSON. Run \`atoa reset --yes\` then \`atoa login\` to re-establish credentials.`
    );
  }
}

/**
 * icacls argv that locks `dir` to `user` only: `/inheritance:r` strips inherited
 * ACEs, `/grant:r user:(OI)(CI)F` grants the user full control and makes the ACE
 * inheritable to files (OI) and subdirs (CI) so the credential files created inside
 * are owner-only too; `/T` reapplies to anything already there, `/C /Q` continue
 * quietly. Pure so it can be unit-tested without spawning.
 */
export function windowsLockdownArgs(dir: string, user: string): string[] {
  return [dir, "/inheritance:r", "/grant:r", `${user}:(OI)(CI)F`, "/T", "/C", "/Q"];
}

/**
 * Windows has no 0600 — `fs` mode is ignored, so files inherit the parent dir's ACL
 * (often readable by other accounts). Lock the dir down with icacls instead. POSIX
 * relies on the 0700 dir + 0600 files and skips this. Best-effort: on failure we warn
 * rather than crash login, but never silently leave the files exposed.
 */
async function lockdownWindows(dir: string): Promise<void> {
  if (process.platform !== "win32") return;
  const ok = await new Promise<boolean>((resolve) => {
    try {
      const child = spawn("icacls", windowsLockdownArgs(dir, userInfo().username), {stdio: "ignore"});
      child.once("error", () => resolve(false));
      child.once("close", (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
  if (!ok) {
    process.stderr.write(
      `Warning: could not restrict permissions on ${dir} (icacls failed). ` +
        `Credential files there may be readable by other accounts on this machine — secure them manually.\n`
    );
  }
}

/** Create the auth dir (0700 on POSIX) and lock it to the current user on Windows. */
export async function ensureAuthDirSecure(): Promise<void> {
  const dir = authDir();
  await fs.mkdir(dir, {recursive: true, mode: 0o700});
  await lockdownWindows(dir);
}

async function writeSessionFile(data: SessionFile): Promise<void> {
  const fp = sessionFilePath();
  const tmp = `${fp}.tmp.${process.pid}`;
  await ensureAuthDirSecure();
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + "\n", {mode: 0o600});
  await fs.rename(tmp, fp);
  if (process.platform !== "win32") await fs.chmod(fp, 0o600);
}

// Lockfile around the read-modify-write so two concurrent `atoa login`s don't clobber each other.
const LOCK_RETRY_MS = 50;
const LOCK_MAX_WAIT_MS = 5000;

function lockFilePath(): string {
  return sessionFilePath() + ".lock";
}

async function acquireLock(): Promise<() => Promise<void>> {
  const lockPath = lockFilePath();
  await fs.mkdir(join(lockPath, ".."), {recursive: true, mode: 0o700});
  const started = Date.now();
  for (;;) {
    try {
      const handle = await fs.open(lockPath, "wx", 0o600);
      await handle.writeFile(String(process.pid));
      await handle.close();
      return async () => {
        try {
          await fs.unlink(lockPath);
        } catch {
          // already gone — fine
        }
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (Date.now() - started > LOCK_MAX_WAIT_MS) {
        throw new Error(
          `Timed out acquiring lock on ${lockPath} after ${LOCK_MAX_WAIT_MS}ms. ` +
            `If no other atoa process is running, remove it manually: rm "${lockPath}"`
        );
      }
      await new Promise((r) => setTimeout(r, LOCK_RETRY_MS));
    }
  }
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const release = await acquireLock();
  try {
    return await fn();
  } finally {
    await release();
  }
}

/**
 * File-only credential store (no OS keychain — mirrors how gh/other CLIs keep tokens in a file).
 * JWT sessions live in ~/.atoa/auth/session.json; SDK keys live in ~/.atoa/auth/secret_key.json
 * (see sdk-key-file.ts). The SDK get/set/delete methods below remain for interface compatibility
 * but are unused now that SDK keys are managed in their own file.
 */
const fileStore: SecretsStore = {
  backend: () => "file",
  async get() {
    return undefined;
  },
  async set() {
    /* SDK secrets are stored via sdk-key-file.ts, not here */
  },
  async delete() {
    /* no-op */
  },
  async deleteProfile(profile) {
    await withLock(async () => {
      const data = await readSessionFile();
      delete data.sessions[profile];
      await writeSessionFile(data);
    });
  },
  async setJwtTokens(profile, tokens) {
    await withLock(async () => {
      const data = await readSessionFile();
      data.sessions[profile] = {accessToken: tokens.accessToken, refreshToken: tokens.refreshToken};
      await writeSessionFile(data);
    });
  },
  async getJwtTokens(profile) {
    const data = await readSessionFile();
    const session = data.sessions[profile];
    if (!session?.accessToken || !session?.refreshToken) return null;
    return {accessToken: session.accessToken, refreshToken: session.refreshToken};
  },
  async clearJwtTokens(profile) {
    await withLock(async () => {
      const data = await readSessionFile();
      delete data.sessions[profile];
      await writeSessionFile(data);
    });
  }
};

export async function createSecretsStore(): Promise<SecretsStore> {
  // File-only by design: SDK secrets live in the auth file, never the OS keychain.
  return fileStore;
}
