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
 * icacls argv that locks `dir` to `user` only: `/inheritance:r` strips ACEs inherited
 * from the parent, `/grant:r user:(OI)(CI)F` makes the user the sole grantee with full
 * control, inheritable to files (OI) and subdirs (CI) so credential files created inside
 * are owner-only too; `/C /Q` continue quietly. Pure so it can be unit-tested.
 *
 * Deliberately NO `/T`. Recursing the grant onto EXISTING leaf files reapplied the
 * (OI)(CI) inheritance flags to them — meaningless on a leaf, so paired with
 * `/inheritance:r` (which strips the file's real inherited ACE) it left the file with an
 * EMPTY effective DACL: access denied to everyone, including the owner. That poisoned the
 * live session.json.lock this same dir holds — `release`'s unlink then failed EPERM and
 * every later command hung 5s unable to stat or reclaim the orphan (Windows-only). The dir
 * lockdown alone secures the tree (other accounts can't even traverse in) and new children
 * inherit owner-only via the (OI)(CI) ACE, so `/T` was redundant AND harmful.
 */
export function windowsLockdownArgs(dir: string, user: string): string[] {
  return [dir, "/inheritance:r", "/grant:r", `${user}:(OI)(CI)F`, "/C", "/Q"];
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
// A lock older than this is treated as orphaned. A legitimate hold is one file read + one
// write (sub-second, always), so a live holder NEVER sits on the lock for 2s — anything that
// old was abandoned by a killed/crashed process. This MUST stay well below LOCK_MAX_WAIT_MS,
// or the reclaim never fires before we give up (the original 30s > 5s bug). The PID probe
// below is a fast-path on top; it's unreliable on Windows, so this time bound is the real
// guarantee. ponytail: time + PID staleness, not a proper-lockfile heartbeat — fine for a
// local single-user CLI; revisit only if these locks ever span machines.
const LOCK_STALE_MS = 2_000;

// ponytail: gated stderr tracer for the lock lifecycle — no logging framework, no deps.
// Enable with ATOA_LOCK_DEBUG=1 to see who creates/reclaims/releases session.lock, from which
// pid, and when. The ISO timestamp + pid let you line up logs from two terminals side by side.
// Exported so the http refresh path can log through the same format. Remove once the lock
// question is settled.
export function lockLog(msg: string): void {
  if (!process.env.ATOA_LOCK_DEBUG) return;
  process.stderr.write(`[lock pid=${process.pid} ${new Date().toISOString()}] ${msg}\n`);
}

export function lockFilePath(): string {
  return sessionFilePath() + ".lock";
}

/**
 * True when the lock was orphaned by a process that's no longer running — Ctrl-C, a
 * closed terminal (common on Windows), or a crash mid-hold. Without this, one such
 * orphan bricks every future credential write until the user manually rm's the file.
 * Reclaims if the recorded owner PID is dead, or (fallback) if the file is impossibly old.
 */
async function lockIsStale(lockPath: string): Promise<boolean> {
  let mtimeMs: number;
  try {
    mtimeMs = (await fs.stat(lockPath)).mtimeMs;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // ENOENT is the benign POSIX race: the lock genuinely vanished between our EEXIST and this
    // stat, so the next open() grabs it — keep waiting. ANY OTHER code (EBUSY sharing violation,
    // EPERM/EACCES ACL, or an IO error from a OneDrive/reparse placeholder) means the file EXISTS
    // — open() just told us EEXIST — but its metadata is unreadable. Those never "just vanish", so
    // returning false here livelocks (open=EEXIST forever, stat=throw forever) to the 5s timeout.
    // Our own lock is always statable by others (the handle is closed before the critical section),
    // so an unstattable lock is never a live holder — treat it as reclaimable and delete it.
    if (code === "ENOENT") {
      lockLog("stale-check: lock ENOENT — genuinely vanished, retry will grab it");
      return false;
    }
    lockLog(`stale-check: stat FAILED code=${code} but lock EXISTS — treating as stale to force reclaim`);
    return true;
  }
  const ageMs = Date.now() - mtimeMs;
  if (ageMs > LOCK_STALE_MS) {
    lockLog(`stale-check: age ${ageMs}ms > ${LOCK_STALE_MS}ms — ORPHANED, reclaiming`);
    return true;
  }
  try {
    const raw = await fs.readFile(lockPath, "utf8");
    const pid = parseInt(raw, 10);
    if (!Number.isInteger(pid)) {
      lockLog(`stale-check: age ${ageMs}ms, no valid pid (${JSON.stringify(raw)}) — treating as held`);
      return false;
    }
    process.kill(pid, 0); // signal 0 = existence probe; throws ESRCH if the owner is gone
    lockLog(`stale-check: age ${ageMs}ms, owner pid=${pid} ALIVE — real holder, waiting`);
    return false; // owner still alive — a real concurrent writer, wait for it
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const dead = code === "ESRCH";
    lockLog(
      `stale-check: age ${ageMs}ms, owner probe -> ${dead ? "DEAD (ESRCH), reclaiming" : `code=${code}, treating as held`}`
    );
    return dead;
  }
}

async function acquireLock(label: string): Promise<() => Promise<void>> {
  const lockPath = lockFilePath();
  await fs.mkdir(join(lockPath, ".."), {recursive: true, mode: 0o700});
  const started = Date.now();
  lockLog(`acquire[${label}]: attempting ${lockPath}`);
  for (;;) {
    try {
      const handle = await fs.open(lockPath, "wx", 0o600);
      await handle.writeFile(String(process.pid));
      await handle.close();
      lockLog(`acquire[${label}]: CREATED (held by pid=${process.pid})`);
      return async () => {
        try {
          await fs.unlink(lockPath);
          lockLog(`release[${label}]: unlinked lock`);
        } catch (unlinkErr) {
          // POSIX: already reclaimed — fine. Windows: an open handle (ours, or AV/Search
          // indexer scanning the freshly-created file) makes unlink EPERM/EBUSY, leaving the
          // lock on disk. That orphan is exactly what deadlocks the NEXT command.
          lockLog(
            `release[${label}]: unlink FAILED code=${(unlinkErr as NodeJS.ErrnoException).code} — lock left on disk`
          );
        }
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
        lockLog(`acquire[${label}]: unexpected error code=${(err as NodeJS.ErrnoException).code}`);
        throw err;
      }
      // Orphaned lock from a killed/crashed process? Reclaim it and retry at once.
      if (await lockIsStale(lockPath)) {
        try {
          await fs.unlink(lockPath);
          lockLog(`acquire[${label}]: reclaimed orphaned lock, retrying`);
        } catch (reclaimErr) {
          // If we judged the lock stale but CAN'T delete it (Windows open-handle EPERM/EBUSY),
          // the loop re-detects it stale and re-fails to delete on every pass — spinning until
          // the 5s timeout. Previously swallowed silently; logged loudly now so it's visible.
          lockLog(
            `acquire[${label}]: reclaim unlink FAILED code=${(reclaimErr as NodeJS.ErrnoException).code} — will spin until timeout`
          );
        }
        continue;
      }
      if (Date.now() - started > LOCK_MAX_WAIT_MS) {
        lockLog(`acquire[${label}]: TIMEOUT after ${Date.now() - started}ms`);
        throw new Error(
          `Timed out acquiring lock on ${lockPath} after ${LOCK_MAX_WAIT_MS}ms. ` +
            `If no other atoa process is running, remove it manually: rm "${lockPath}"`
        );
      }
      await new Promise((r) => setTimeout(r, LOCK_RETRY_MS));
    }
  }
}

async function withLock<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const release = await acquireLock(label);
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
    await withLock("deleteProfile", async () => {
      const data = await readSessionFile();
      delete data.sessions[profile];
      await writeSessionFile(data);
    });
  },
  async setJwtTokens(profile, tokens) {
    await withLock("setJwtTokens", async () => {
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
    await withLock("clearJwtTokens", async () => {
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
