import {promises as fs} from "fs";
import {homedir} from "os";
import {join} from "path";

export type SecretsEnv = "sandbox" | "production";

export interface SecretsStore {
  get(profile: string, env: SecretsEnv): Promise<string | undefined>;
  set(profile: string, env: SecretsEnv, token: string): Promise<void>;
  delete(profile: string, env: SecretsEnv): Promise<void>;
  deleteProfile(profile: string): Promise<void>;
  backend(): "system" | "file";
}

function slotKey(profile: string, env: SecretsEnv): string {
  return `${profile}:${env}`;
}

const SERVICE = "atoa-cli";

export function configHomeDir(): string {
  return process.env.ATOA_HOME ?? homedir();
}

export function secretsFilePath(): string {
  return join(configHomeDir(), ".config", "atoa", "secrets.json");
}

async function readSecretsFile(): Promise<Record<string, string>> {
  const fp = secretsFilePath();
  let raw: string;
  try {
    const st = await fs.stat(fp);
    if (process.platform !== "win32" && st.mode & 0o077) {
      throw new Error(
        `Refusing to read ${fp}: insecure permissions (mode ${(st.mode & 0o777).toString(8)}). ` +
          `Run: chmod 600 "${fp}"`
      );
    }
    raw = await fs.readFile(fp, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }

  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    throw new Error(
      `Refusing to parse ${fp}: not valid JSON. ` +
        `If this file was written by an older CLI build, run ` +
        `\`atoa reset --yes\` then \`atoa login\` to re-establish credentials.`
    );
  }
}

async function writeSecretsFile(data: Record<string, string>): Promise<void> {
  const fp = secretsFilePath();
  const dir = join(fp, "..");
  const tmp = `${fp}.tmp.${process.pid}`;
  await fs.mkdir(dir, {recursive: true, mode: 0o700});
  await fs.writeFile(tmp, JSON.stringify(data), {mode: 0o600});
  await fs.rename(tmp, fp);
  if (process.platform !== "win32") await fs.chmod(fp, 0o600);
}

/**
 * Hand-rolled lockfile around the read-modify-write transaction.
 *
 * Two concurrent `atoa login`s on the same machine would otherwise race on the
 * secrets.json read-modify-write: both load the same baseline, each writes its
 * own added entry, the second write wins and the first entry is lost.
 *
 * `fs.open(..., "wx")` is the cross-platform mutex primitive — it's atomic on
 * POSIX and on NTFS, and fails with `EEXIST` when the file already exists.
 *
 * Pattern is well-trodden — same shape as `proper-lockfile` but without the
 * dependency. Held for the duration of the read+write; cleaned up in `finally`
 * so a crash mid-update doesn't strand the lock. Stale-lock detection is
 * intentionally NOT done — the lock window is milliseconds and the recovery
 * path (`rm ~/.config/atoa/secrets.json.lock`) is trivial to document.
 */
const LOCK_RETRY_MS = 50;
const LOCK_MAX_WAIT_MS = 5000;

function lockFilePath(): string {
  return secretsFilePath() + ".lock";
}

async function acquireLock(): Promise<() => Promise<void>> {
  const lockPath = lockFilePath();
  const dir = join(lockPath, "..");
  await fs.mkdir(dir, {recursive: true, mode: 0o700});

  const started = Date.now();
  while (true) {
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
            `If no other atoa process is running, remove the lockfile manually: rm "${lockPath}"`
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

const fileStore: SecretsStore = {
  backend: () => "file",
  // Reads don't take the lock — concurrent readers can't corrupt anything, and
  // a read overlapping a write either sees the pre-rename file (whole, stale by
  // microseconds) or the post-rename file (whole, fresh). Atomic rename is the
  // existing guarantee that makes this safe.
  async get(profile, env) {
    const data = await readSecretsFile();
    return data[slotKey(profile, env)] || undefined;
  },
  async set(profile, env, token) {
    await withLock(async () => {
      const data = await readSecretsFile();
      data[slotKey(profile, env)] = token;
      await writeSecretsFile(data);
    });
  },
  async delete(profile, env) {
    await withLock(async () => {
      const data = await readSecretsFile();
      delete data[slotKey(profile, env)];
      await writeSecretsFile(data);
    });
  },
  async deleteProfile(profile) {
    await withLock(async () => {
      const data = await readSecretsFile();
      delete data[slotKey(profile, "sandbox")];
      delete data[slotKey(profile, "production")];
      await writeSecretsFile(data);
    });
  }
};

export async function createSecretsStore(): Promise<SecretsStore> {
  try {
    // works under pkg. `as typeof import(...)` preserves the ESM-style types.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const {Entry} = require("@napi-rs/keyring") as typeof import("@napi-rs/keyring");
    // Probe to verify keychain is accessible on this platform.
    new Entry(SERVICE, "__probe__").getPassword();
    return {
      backend: () => "system",
      async get(profile, env) {
        const val = new Entry(SERVICE, slotKey(profile, env)).getPassword();
        return val ?? undefined;
      },
      async set(profile, env, token) {
        new Entry(SERVICE, slotKey(profile, env)).setPassword(token);
      },
      async delete(profile, env) {
        try {
          new Entry(SERVICE, slotKey(profile, env)).deletePassword();
        } catch {
          // not found — nothing to delete
        }
      },
      async deleteProfile(profile) {
        for (const env of ["sandbox", "production"] as SecretsEnv[]) {
          try {
            new Entry(SERVICE, slotKey(profile, env)).deletePassword();
          } catch {
            // not found — skip
          }
        }
      }
    };
  } catch {
    return fileStore;
  }
}
