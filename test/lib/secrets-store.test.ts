import {describe, it, expect, beforeEach, afterEach} from "vitest";
import {promises as fs} from "fs";
import {homedir, tmpdir} from "os";
import {join} from "path";
import {configHomeDir, authDir, sessionFilePath, createSecretsStore} from "../../src/lib/secrets-store";

/**
 * The secrets store is FILE-ONLY (no OS keychain). Tests point `ATOA_HOME` at a
 * fresh tmpdir; the session file lands at <ATOA_HOME>/atoa/auth/session.json.
 *
 * JWT sessions live in session.json under a `sessions` map keyed by
 * `<profile>:<env>`. SDK get/set/delete are no-ops (SDK keys live elsewhere,
 * in ~/atoa/auth/secret_key.json), so we assert the no-op behaviour here.
 */

let scratchDir: string;

async function withFileBackend(): Promise<void> {
  scratchDir = await fs.mkdtemp(join(tmpdir(), "atoa-test-"));
  process.env.ATOA_HOME = scratchDir;
}

async function cleanupFileBackend(): Promise<void> {
  delete process.env.ATOA_HOME;
  if (scratchDir) {
    await fs.rm(scratchDir, {recursive: true, force: true}).catch(() => undefined);
  }
}

describe("configHomeDir", () => {
  afterEach(() => {
    delete process.env.ATOA_HOME;
  });

  it("returns ATOA_HOME when set", () => {
    process.env.ATOA_HOME = "/custom/atoa";
    expect(configHomeDir()).toBe("/custom/atoa");
  });

  it("falls back to os.homedir() when ATOA_HOME is not set", () => {
    delete process.env.ATOA_HOME;
    expect(configHomeDir()).toBe(homedir());
  });
});

describe("path helpers", () => {
  afterEach(() => {
    delete process.env.ATOA_HOME;
  });

  it("authDir composes <ATOA_HOME>/.atoa/auth", () => {
    process.env.ATOA_HOME = "/tmp/atoa-test";
    expect(authDir()).toBe(join("/tmp/atoa-test", ".atoa", "auth"));
  });

  it("sessionFilePath composes <ATOA_HOME>/.atoa/auth/session.json", () => {
    process.env.ATOA_HOME = "/tmp/atoa-test";
    expect(sessionFilePath()).toBe(join("/tmp/atoa-test", ".atoa", "auth", "session.json"));
  });
});

describe("backend", () => {
  beforeEach(withFileBackend);
  afterEach(cleanupFileBackend);

  it("always reports the file backend", async () => {
    const store = await createSecretsStore();
    expect(store.backend()).toBe("file");
  });
});

describe("SDK get/set/delete — no-ops", () => {
  beforeEach(withFileBackend);
  afterEach(cleanupFileBackend);

  it("get returns undefined (SDK keys stored elsewhere)", async () => {
    const store = await createSecretsStore();
    expect(await store.get("acme", "sandbox")).toBeUndefined();
  });

  it("set is a no-op and does not create a session file", async () => {
    const store = await createSecretsStore();
    await store.set("acme", "sandbox", "tk_abc123");
    expect(await store.get("acme", "sandbox")).toBeUndefined();
    await expect(fs.access(sessionFilePath())).rejects.toThrow();
  });

  it("delete is a no-op (does not throw)", async () => {
    const store = await createSecretsStore();
    await expect(store.delete("acme", "sandbox")).resolves.not.toThrow();
  });
});

describe("JWT round-trip", () => {
  beforeEach(withFileBackend);
  afterEach(cleanupFileBackend);

  it("returns null for an unset profile", async () => {
    const store = await createSecretsStore();
    expect(await store.getJwtTokens("acme")).toBeNull();
  });

  it("set then get round-trips the tokens", async () => {
    const store = await createSecretsStore();
    await store.setJwtTokens("acme", {accessToken: "at_1", refreshToken: "rt_1"});
    expect(await store.getJwtTokens("acme")).toEqual({accessToken: "at_1", refreshToken: "rt_1"});
  });

  it("isolates sessions by profile (no cross-contamination)", async () => {
    const store = await createSecretsStore();
    await store.setJwtTokens("acme", {accessToken: "at_acme", refreshToken: "rt_acme"});
    await store.setJwtTokens("other-merchant", {accessToken: "at_other", refreshToken: "rt_other"});

    expect(await store.getJwtTokens("acme")).toEqual({accessToken: "at_acme", refreshToken: "rt_acme"});
    expect(await store.getJwtTokens("other-merchant")).toEqual({accessToken: "at_other", refreshToken: "rt_other"});
  });

  it("setJwtTokens overwrites the profile's session (env-independent — no second slot)", async () => {
    const store = await createSecretsStore();
    await store.setJwtTokens("acme", {accessToken: "at_old", refreshToken: "rt_old"});
    await store.setJwtTokens("acme", {accessToken: "at_new", refreshToken: "rt_new"});
    expect(await store.getJwtTokens("acme")).toEqual({accessToken: "at_new", refreshToken: "rt_new"});
  });

  it("clearJwtTokens clears the profile session", async () => {
    const store = await createSecretsStore();
    await store.setJwtTokens("acme", {accessToken: "at_1", refreshToken: "rt_1"});

    await store.clearJwtTokens("acme");
    expect(await store.getJwtTokens("acme")).toBeNull();
  });

  it("deleteProfile clears a profile's session but spares other profiles", async () => {
    const store = await createSecretsStore();
    await store.setJwtTokens("acme", {accessToken: "a-1", refreshToken: "a-1-r"});
    await store.setJwtTokens("other", {accessToken: "o-1", refreshToken: "o-1-r"});

    await store.deleteProfile("acme");
    expect(await store.getJwtTokens("acme")).toBeNull();
    expect(await store.getJwtTokens("other")).toEqual({accessToken: "o-1", refreshToken: "o-1-r"});
  });
});

describe("on-disk format", () => {
  beforeEach(withFileBackend);
  afterEach(cleanupFileBackend);

  it("writes plain JSON at the session file path under a `sessions` map", async () => {
    const store = await createSecretsStore();
    await store.setJwtTokens("acme", {accessToken: "at_plain", refreshToken: "rt_plain"});

    const raw = await fs.readFile(sessionFilePath(), "utf8");
    const parsed = JSON.parse(raw) as {sessions: Record<string, {accessToken: string; refreshToken: string}>};
    expect(parsed.sessions["acme"]).toEqual({accessToken: "at_plain", refreshToken: "rt_plain"});
  });

  it("uses `<profile>` as the session key (env-independent)", async () => {
    const store = await createSecretsStore();
    await store.setJwtTokens("acme-uk", {accessToken: "at", refreshToken: "rt"});

    const raw = await fs.readFile(sessionFilePath(), "utf8");
    const parsed = JSON.parse(raw) as {sessions: Record<string, unknown>};
    expect(Object.keys(parsed.sessions)).toContain("acme-uk");
  });
});

describe("read-side guards", () => {
  beforeEach(withFileBackend);
  afterEach(cleanupFileBackend);

  it("throws a clear error when session.json contains invalid JSON", async () => {
    const fp = sessionFilePath();
    await fs.mkdir(join(fp, ".."), {recursive: true, mode: 0o700});
    await fs.writeFile(fp, "{ definitely not JSON", {mode: 0o600});

    const store = await createSecretsStore();
    await expect(store.getJwtTokens("acme")).rejects.toThrow(/Refusing to parse.*not valid JSON/);
  });

  it("includes the `atoa reset` recovery hint in the parse-error message", async () => {
    const fp = sessionFilePath();
    await fs.mkdir(join(fp, ".."), {recursive: true, mode: 0o700});
    await fs.writeFile(fp, "garbage", {mode: 0o600});

    const store = await createSecretsStore();
    await expect(store.getJwtTokens("acme")).rejects.toThrow(/atoa reset --yes/);
  });

  it.runIf(process.platform !== "win32")("refuses to read when permissions are insecure (POSIX only)", async () => {
    const fp = sessionFilePath();
    await fs.mkdir(join(fp, ".."), {recursive: true, mode: 0o700});
    await fs.writeFile(fp, JSON.stringify({sessions: {}}), {mode: 0o644}); // group/other readable

    const store = await createSecretsStore();
    await expect(store.getJwtTokens("acme")).rejects.toThrow(/insecure permissions/);
  });

  it.runIf(process.platform !== "win32")("permission-refusal message includes the chmod fix command", async () => {
    const fp = sessionFilePath();
    await fs.mkdir(join(fp, ".."), {recursive: true, mode: 0o700});
    await fs.writeFile(fp, "{}", {mode: 0o644});

    const store = await createSecretsStore();
    await expect(store.getJwtTokens("acme")).rejects.toThrow(/chmod 600/);
  });
});

describe("atomic writes", () => {
  beforeEach(withFileBackend);
  afterEach(cleanupFileBackend);

  it("leaves no tmp file behind after a successful write", async () => {
    const store = await createSecretsStore();
    await store.setJwtTokens("acme", {accessToken: "at", refreshToken: "rt"});

    const dir = authDir();
    const files = await fs.readdir(dir);
    const tmpFiles = files.filter((f) => f.startsWith("session.json.tmp"));
    expect(tmpFiles).toEqual([]);
  });

  it("creates the parent directory tree if it doesn't exist yet", async () => {
    const store = await createSecretsStore();
    // fresh scratch — directory doesn't exist
    await store.setJwtTokens("first-login", {accessToken: "at", refreshToken: "rt"});

    const stat = await fs.stat(sessionFilePath());
    expect(stat.isFile()).toBe(true);
  });
});

describe("concurrent writes (lockfile)", () => {
  beforeEach(withFileBackend);
  afterEach(cleanupFileBackend);

  it("does not lose writes when N concurrent setJwtTokens calls race on the same file", async () => {
    const store = await createSecretsStore();

    // Spawn 20 concurrent writes, each adding a unique profile slot. Without
    // the lockfile, the read-modify-write race drops at least one entry on any
    // machine fast enough to overlap the I/O. With the lock, all 20 land.
    const N = 20;
    await Promise.all(
      Array.from({length: N}, (_, i) =>
        store.setJwtTokens(`profile-${i}`, {accessToken: `at-${i}`, refreshToken: `rt-${i}`})
      )
    );

    const surviving = await Promise.all(Array.from({length: N}, (_, i) => store.getJwtTokens(`profile-${i}`)));
    for (let i = 0; i < N; i++) {
      expect(surviving[i]).toEqual({accessToken: `at-${i}`, refreshToken: `rt-${i}`});
    }
  });

  it("removes the lockfile after a successful write", async () => {
    const store = await createSecretsStore();
    await store.setJwtTokens("acme", {accessToken: "at", refreshToken: "rt"});

    const lockPath = sessionFilePath() + ".lock";
    await expect(fs.stat(lockPath)).rejects.toMatchObject({code: "ENOENT"});
  });

  it("reclaims an orphaned lock left by a killed process instead of timing out", async () => {
    const store = await createSecretsStore();

    // Simulate a process that was Ctrl-C'd / crashed mid-hold: a lock file left on
    // disk, owned by a PID that isn't running, and old enough to be unambiguously
    // stale. Before stale-lock recovery this hangs ~5s then throws "Timed out
    // acquiring lock" — and stayed broken until the user manually rm'd the file.
    const lockPath = sessionFilePath() + ".lock";
    await fs.mkdir(join(lockPath, ".."), {recursive: true, mode: 0o700});
    await fs.writeFile(lockPath, "999999", {mode: 0o600});
    const old = new Date(Date.now() - 60_000);
    await fs.utimes(lockPath, old, old);

    await store.setJwtTokens("acme", {accessToken: "at", refreshToken: "rt"});
    expect(await store.getJwtTokens("acme")).toEqual({accessToken: "at", refreshToken: "rt"});
  });

  it("reclaims a stale lock by age even when the owner PID is alive (the Windows fix)", async () => {
    const store = await createSecretsStore();

    // The Windows failure: process.kill(pid,0) doesn't reliably report a dead owner, so the
    // PID fast-path can't reclaim. Simulate the worst case — a LIVE pid (our own) — so only
    // the time bound can save us. With the old 30s threshold (> the 5s acquire timeout) this
    // hung and threw; with the 2s bound the orphan is reclaimed promptly.
    const lockPath = sessionFilePath() + ".lock";
    await fs.mkdir(join(lockPath, ".."), {recursive: true, mode: 0o700});
    await fs.writeFile(lockPath, String(process.pid), {mode: 0o600});
    const old = new Date(Date.now() - 3000); // older than LOCK_STALE_MS
    await fs.utimes(lockPath, old, old);

    await store.setJwtTokens("acme", {accessToken: "at", refreshToken: "rt"});
    expect(await store.getJwtTokens("acme")).toEqual({accessToken: "at", refreshToken: "rt"});
  });

  it("releases the lockfile even when the wrapped write throws", async () => {
    const store = await createSecretsStore();

    // Corrupt the existing session file to force a parse-error mid-update; the
    // lock should still be released on the way out via the `finally` cleanup.
    await store.setJwtTokens("seed", {accessToken: "at", refreshToken: "rt"});
    const fp = sessionFilePath();
    await fs.writeFile(fp, "{ not valid json", "utf8");

    await expect(store.setJwtTokens("acme", {accessToken: "at", refreshToken: "rt"})).rejects.toThrow();

    const lockPath = fp + ".lock";
    await expect(fs.stat(lockPath)).rejects.toMatchObject({code: "ENOENT"});
  });
});
