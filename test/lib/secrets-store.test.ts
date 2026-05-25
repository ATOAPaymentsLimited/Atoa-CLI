import {describe, it, expect, beforeEach, afterEach} from "vitest";
import {promises as fs} from "fs";
import {homedir, tmpdir} from "os";
import {join} from "path";
import {configHomeDir, secretsFilePath, createSecretsStore} from "../../src/lib/secrets-store";

/**
 * Most tests run against the FILE backend by temporarily pointing `ATOA_HOME`
 * at a fresh tmpdir. The file backend is the security-critical fallback that
 * the reviewer specifically called out as undertested (round-4 finding W).
 *
 * The keychain backend (`@napi-rs/keyring`) is platform-dependent — it relies
 * on Keychain (macOS) / Credential Manager (Windows) / libsecret (Linux). We
 * can't reliably exercise it in CI on every platform, so we cover the file
 * fallback (which is what runs in Docker / CI / headless Linux anyway).
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

describe("secretsFilePath", () => {
  afterEach(() => {
    delete process.env.ATOA_HOME;
  });

  it("composes <ATOA_HOME>/.config/atoa/secrets.json", () => {
    process.env.ATOA_HOME = "/tmp/atoa-test";
    expect(secretsFilePath()).toBe(join("/tmp/atoa-test", ".config", "atoa", "secrets.json"));
  });
});

describe("file backend — basic round-trip", () => {
  beforeEach(withFileBackend);
  afterEach(cleanupFileBackend);

  it("returns undefined for an unset slot", async () => {
    const store = await createSecretsStore();
    if (store.backend() !== "file") return; // skip when machine has a keychain
    const got = await store.get("acme", "sandbox");
    expect(got).toBeUndefined();
  });

  it("set then get round-trips the token", async () => {
    const store = await createSecretsStore();
    if (store.backend() !== "file") return;
    await store.set("acme", "sandbox", "tk_abc123");
    expect(await store.get("acme", "sandbox")).toBe("tk_abc123");
  });

  it("isolates slots by profile + env (no cross-contamination)", async () => {
    const store = await createSecretsStore();
    if (store.backend() !== "file") return;
    await store.set("acme", "sandbox", "sb-token");
    await store.set("acme", "production", "prod-token");
    await store.set("other-merchant", "sandbox", "other-sb");

    expect(await store.get("acme", "sandbox")).toBe("sb-token");
    expect(await store.get("acme", "production")).toBe("prod-token");
    expect(await store.get("other-merchant", "sandbox")).toBe("other-sb");
    expect(await store.get("other-merchant", "production")).toBeUndefined();
  });

  it("delete clears just the one slot, not the other env", async () => {
    const store = await createSecretsStore();
    if (store.backend() !== "file") return;
    await store.set("acme", "sandbox", "sb");
    await store.set("acme", "production", "prod");

    await store.delete("acme", "sandbox");
    expect(await store.get("acme", "sandbox")).toBeUndefined();
    expect(await store.get("acme", "production")).toBe("prod");
  });

  it("deleteProfile clears both envs for a profile but spares other profiles", async () => {
    const store = await createSecretsStore();
    if (store.backend() !== "file") return;
    await store.set("acme", "sandbox", "a-sb");
    await store.set("acme", "production", "a-prod");
    await store.set("other", "sandbox", "o-sb");

    await store.deleteProfile("acme");
    expect(await store.get("acme", "sandbox")).toBeUndefined();
    expect(await store.get("acme", "production")).toBeUndefined();
    expect(await store.get("other", "sandbox")).toBe("o-sb");
  });
});

describe("file backend — on-disk format", () => {
  beforeEach(withFileBackend);
  afterEach(cleanupFileBackend);

  it("writes plain JSON at the secrets file path", async () => {
    const store = await createSecretsStore();
    if (store.backend() !== "file") return;
    await store.set("acme", "sandbox", "tk_plain");

    const raw = await fs.readFile(secretsFilePath(), "utf8");
    const parsed = JSON.parse(raw) as Record<string, string>;
    expect(parsed["acme:sandbox"]).toBe("tk_plain");
  });

  it("does NOT create a separate .key file (encryption layer was removed)", async () => {
    const store = await createSecretsStore();
    if (store.backend() !== "file") return;
    await store.set("acme", "sandbox", "tk");

    const keyPath = join(scratchDir, ".config", "atoa", ".key");
    await expect(fs.access(keyPath)).rejects.toThrow();
  });

  it("uses `<profile>:<env>` as the slot key (matches slotKey()'s contract)", async () => {
    const store = await createSecretsStore();
    if (store.backend() !== "file") return;
    await store.set("acme-uk", "production", "tk");

    const raw = await fs.readFile(secretsFilePath(), "utf8");
    const parsed = JSON.parse(raw) as Record<string, string>;
    expect(Object.keys(parsed)).toContain("acme-uk:production");
  });
});

describe("file backend — read-side guards", () => {
  beforeEach(withFileBackend);
  afterEach(cleanupFileBackend);

  it("throws a clear error when secrets.json contains invalid JSON", async () => {
    // Pre-create a corrupt file
    const fp = secretsFilePath();
    await fs.mkdir(join(fp, ".."), {recursive: true, mode: 0o700});
    await fs.writeFile(fp, "{ definitely not JSON", {mode: 0o600});

    const store = await createSecretsStore();
    if (store.backend() !== "file") return;

    await expect(store.get("acme", "sandbox")).rejects.toThrow(/Refusing to parse.*not valid JSON/);
  });

  it("includes the `atoa reset` recovery hint in the parse-error message", async () => {
    const fp = secretsFilePath();
    await fs.mkdir(join(fp, ".."), {recursive: true, mode: 0o700});
    await fs.writeFile(fp, "garbage", {mode: 0o600});

    const store = await createSecretsStore();
    if (store.backend() !== "file") return;

    await expect(store.get("acme", "sandbox")).rejects.toThrow(/atoa reset --yes/);
  });

  it.runIf(process.platform !== "win32")("refuses to read when permissions are insecure (POSIX only)", async () => {
    const fp = secretsFilePath();
    await fs.mkdir(join(fp, ".."), {recursive: true, mode: 0o700});
    await fs.writeFile(fp, JSON.stringify({"acme:sandbox": "tk"}), {mode: 0o644}); // group/other readable

    const store = await createSecretsStore();
    if (store.backend() !== "file") return;

    await expect(store.get("acme", "sandbox")).rejects.toThrow(/insecure permissions/);
  });

  it.runIf(process.platform !== "win32")("permission-refusal message includes the chmod fix command", async () => {
    const fp = secretsFilePath();
    await fs.mkdir(join(fp, ".."), {recursive: true, mode: 0o700});
    await fs.writeFile(fp, "{}", {mode: 0o644});

    const store = await createSecretsStore();
    if (store.backend() !== "file") return;

    await expect(store.get("acme", "sandbox")).rejects.toThrow(/chmod 600/);
  });
});

describe("file backend — atomic writes", () => {
  beforeEach(withFileBackend);
  afterEach(cleanupFileBackend);

  it("leaves no tmp file behind after a successful write", async () => {
    const store = await createSecretsStore();
    if (store.backend() !== "file") return;
    await store.set("acme", "sandbox", "tk");

    const dir = join(scratchDir, ".config", "atoa");
    const files = await fs.readdir(dir);
    const tmpFiles = files.filter((f) => f.startsWith("secrets.json.tmp"));
    expect(tmpFiles).toEqual([]);
  });

  it("creates the parent directory tree if it doesn't exist yet", async () => {
    const store = await createSecretsStore();
    if (store.backend() !== "file") return;
    // fresh scratch — directory doesn't exist
    await store.set("first-login", "sandbox", "tk");

    const fp = secretsFilePath();
    const stat = await fs.stat(fp);
    expect(stat.isFile()).toBe(true);
  });
});

describe("file backend — concurrent writes (lockfile)", () => {
  beforeEach(withFileBackend);
  afterEach(cleanupFileBackend);

  it("does not lose writes when N concurrent set() calls race on the same file", async () => {
    const store = await createSecretsStore();
    if (store.backend() !== "file") return;

    // Spawn 20 concurrent set()s, each adding a unique profile slot. Without
    // the lockfile, the read-modify-write race drops at least one entry on any
    // machine fast enough to overlap the I/O. With the lock, all 20 land.
    const N = 20;
    await Promise.all(Array.from({length: N}, (_, i) => store.set(`profile-${i}`, "sandbox", `tk-${i}`)));

    const surviving = await Promise.all(Array.from({length: N}, (_, i) => store.get(`profile-${i}`, "sandbox")));
    for (let i = 0; i < N; i++) {
      expect(surviving[i]).toBe(`tk-${i}`);
    }
  });

  it("removes the lockfile after a successful write", async () => {
    const store = await createSecretsStore();
    if (store.backend() !== "file") return;
    await store.set("acme", "sandbox", "tk");

    const lockPath = secretsFilePath() + ".lock";
    await expect(fs.stat(lockPath)).rejects.toMatchObject({code: "ENOENT"});
  });

  it("releases the lockfile even when the wrapped write throws", async () => {
    const store = await createSecretsStore();
    if (store.backend() !== "file") return;

    // Corrupt the existing config to force a parse-error mid-update; the lock
    // should still be released on the way out via the `finally` cleanup.
    await store.set("seed", "sandbox", "tk");
    const fp = secretsFilePath();
    await fs.writeFile(fp, "{ not valid json", "utf8");

    await expect(store.set("acme", "sandbox", "tk")).rejects.toThrow();

    const lockPath = fp + ".lock";
    await expect(fs.stat(lockPath)).rejects.toMatchObject({code: "ENOENT"});
  });
});
