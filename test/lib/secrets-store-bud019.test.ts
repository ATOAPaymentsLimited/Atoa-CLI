/**
 * BUD-019 Phase 6 — Task 1
 * Tests for secrets-store JWT session storage:
 *   - setJwtTokens / getJwtTokens / clearJwtTokens
 *
 * Store is FILE-ONLY. Sessions live in <ATOA_HOME>/.atoa/auth/session.json under a
 * `sessions` map keyed by `<profile>` — JWT sessions are env-INDEPENDENT (only SDK
 * keys are per-env).
 */
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import {promises as fs} from "fs";
import {tmpdir} from "os";
import {join} from "path";
import {createSecretsStore, sessionFilePath} from "../../src/lib/secrets-store";

let scratchDir: string;

async function withFileBackend(): Promise<void> {
  scratchDir = await fs.mkdtemp(join(tmpdir(), "atoa-sec-bud019-"));
  process.env.ATOA_HOME = scratchDir;
}

async function cleanupFileBackend(): Promise<void> {
  delete process.env.ATOA_HOME;
  if (scratchDir) {
    await fs.rm(scratchDir, {recursive: true, force: true}).catch(() => undefined);
  }
}

async function writeRawSession(sessions: Record<string, unknown>): Promise<void> {
  const fp = sessionFilePath();
  await fs.mkdir(join(fp, ".."), {recursive: true, mode: 0o700});
  await fs.writeFile(fp, JSON.stringify({sessions}), {mode: 0o600});
}

describe("JWT token storage — file backend", () => {
  beforeEach(withFileBackend);
  afterEach(cleanupFileBackend);

  it("setJwtTokens then getJwtTokens round-trips access and refresh tokens", async () => {
    const store = await createSecretsStore();

    await store.setJwtTokens("acme", {accessToken: "at_abc", refreshToken: "rt_xyz"});

    const got = await store.getJwtTokens("acme");
    expect(got).toEqual({accessToken: "at_abc", refreshToken: "rt_xyz"});
  });

  it("getJwtTokens returns null when nothing has been stored", async () => {
    const store = await createSecretsStore();

    const got = await store.getJwtTokens("acme");
    expect(got).toBeNull();
  });

  it("getJwtTokens returns null when only the access token is present (partial state)", async () => {
    const store = await createSecretsStore();

    await writeRawSession({acme: {accessToken: "at_only"}});

    const got = await store.getJwtTokens("acme");
    expect(got).toBeNull();
  });

  it("getJwtTokens returns null when only the refresh token is present (partial state)", async () => {
    const store = await createSecretsStore();

    await writeRawSession({acme: {refreshToken: "rt_only"}});

    const got = await store.getJwtTokens("acme");
    expect(got).toBeNull();
  });

  it("clearJwtTokens removes both tokens", async () => {
    const store = await createSecretsStore();

    await store.setJwtTokens("acme", {accessToken: "at_1", refreshToken: "rt_1"});

    await store.clearJwtTokens("acme");

    expect(await store.getJwtTokens("acme")).toBeNull();
  });

  it("JWT sessions are isolated per profile (env-independent)", async () => {
    const store = await createSecretsStore();

    await store.setJwtTokens("acme", {accessToken: "at_acme", refreshToken: "rt_acme"});
    await store.setJwtTokens("other", {accessToken: "at_other", refreshToken: "rt_other"});

    expect(await store.getJwtTokens("acme")).toEqual({accessToken: "at_acme", refreshToken: "rt_acme"});
    expect(await store.getJwtTokens("other")).toEqual({accessToken: "at_other", refreshToken: "rt_other"});
    expect(await store.getJwtTokens("missing")).toBeNull();
  });

  it("SDK get/set are no-ops and do not interfere with JWT tokens", async () => {
    const store = await createSecretsStore();

    // SDK set is a no-op (SDK keys live in secret_key.json, not here)
    await store.set("acme", "sandbox", "sdk_token_abc");

    await store.setJwtTokens("acme", {accessToken: "at_jwt", refreshToken: "rt_jwt"});

    // SDK get returns undefined (no-op)
    expect(await store.get("acme", "sandbox")).toBeUndefined();
    // JWT tokens are intact
    expect(await store.getJwtTokens("acme")).toEqual({accessToken: "at_jwt", refreshToken: "rt_jwt"});
  });

  it("stores tokens under a `sessions` map keyed by `<profile>`", async () => {
    const store = await createSecretsStore();

    await store.setJwtTokens("acme", {accessToken: "at_123", refreshToken: "rt_456"});

    const raw = await fs.readFile(sessionFilePath(), "utf8");
    const parsed = JSON.parse(raw) as {sessions: Record<string, {accessToken: string; refreshToken: string}>};
    expect(parsed.sessions["acme"]).toEqual({accessToken: "at_123", refreshToken: "rt_456"});
  });

  it("clearJwtTokens is a no-op when tokens don't exist (does not throw)", async () => {
    const store = await createSecretsStore();

    await expect(store.clearJwtTokens("never-set")).resolves.not.toThrow();
  });
});
