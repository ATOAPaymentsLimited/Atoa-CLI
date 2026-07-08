import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import {promises as fs} from "fs";
import {tmpdir} from "os";
import {join} from "path";

/**
 * logout JWT-mode tests.
 *
 * The CLI is JWT-only. Tests verify:
 *   - jwt mode: calls POST /api/auth/extension-token/revoke with refreshToken, then clears the JWT session
 *   - jwt mode: proceeds with local cleanup even when server revoke fails
 *   - jwt mode: --dryRun reports intent without touching the session file
 *
 * JWT sessions live in ~/.atoa/auth/session.json, shape:
 *   {"sessions": {"<profile>": {"accessToken", "refreshToken"}}}
 */

import {sessionFilePath, authDir} from "../../src/lib/secrets-store";
import {sdkKeyFilePath} from "../../src/lib/sdk-key-file";
import {configFilePath} from "../../src/lib/config-store";

// logoutJwt does a best-effort server revoke via its OWN http client. Stub lib/http so tests never
// touch a real network (localhost:9090) — a rejected request is exactly the "revoke failed, proceed
// with local cleanup" path the tests assert. Without this the revoke can hang on the local stack.
vi.mock("../../src/lib/http", async () => {
  const actual = await vi.importActual<any>("../../src/lib/http");
  return {
    ...actual,
    assertTlsHardenedEnv: () => {},
    buildHttpClient: () => ({
      baseUrl: "https://api.atoa.test",
      request: async () => {
        throw new Error("server revoke unavailable in test");
      }
    })
  };
});

import logout from "../../src/commands/logout";

let scratch: string;

beforeEach(async () => {
  scratch = await fs.mkdtemp(join(tmpdir(), "atoa-logout-"));
  process.env.ATOA_HOME = scratch;
  process.exitCode = 0;
});

afterEach(async () => {
  delete process.env.ATOA_HOME;
  await fs.rm(scratch, {recursive: true, force: true}).catch(() => undefined);
  process.exitCode = 0;
});

async function writeConfigFile(cfg: unknown): Promise<void> {
  await fs.mkdir(join(scratch, ".config", "atoa"), {recursive: true, mode: 0o700});
  await fs.writeFile(configFilePath(), JSON.stringify(cfg, null, 2), {mode: 0o600});
}

async function writeSessionFile(sessions: Record<string, {accessToken: string; refreshToken: string}>): Promise<void> {
  await fs.mkdir(authDir(), {recursive: true, mode: 0o700});
  await fs.writeFile(sessionFilePath(), JSON.stringify({sessions}), {mode: 0o600});
}

async function readSessions(): Promise<Record<string, {accessToken: string; refreshToken: string}>> {
  return JSON.parse(await fs.readFile(sessionFilePath(), "utf8")).sessions;
}

async function writeSdkKeyFile(keys: unknown[]): Promise<void> {
  await fs.mkdir(authDir(), {recursive: true, mode: 0o700});
  await fs.writeFile(sdkKeyFilePath(), JSON.stringify({keys}), {mode: 0o600});
}

async function readSdkKeys(): Promise<Array<{profile: string; env: string}>> {
  return JSON.parse(await fs.readFile(sdkKeyFilePath(), "utf8")).keys;
}

/** Build a JWT-mode profile config */
function jwtProfile() {
  return {
    schemaVersion: 1,
    activeProfile: "acme",
    profiles: {
      acme: {
        businessId: "b1",
        displayName: "Acme",
        defaultEnv: "sandbox",
        envs: {
          sandbox: {tokenFingerprint: "x", authMode: "jwt"}
        }
      }
    }
  };
}

describe("atoa logout — jwt mode", () => {
  it("clears the JWT session on success", async () => {
    await writeConfigFile(jwtProfile());
    await writeSessionFile({acme: {accessToken: "at_abc", refreshToken: "rt_xyz"}});

    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    // The revoke call will fail (no real server) but that's expected — it's best-effort
    await (logout.run as any)({args: {env: "sandbox", yes: true}, rawArgs: []});

    const sessions = await readSessions();
    expect(sessions.acme).toBeUndefined();

    stdout.mockRestore();
    stderr.mockRestore();
  });

  it("proceeds with local cleanup even when server revoke fails (network error)", async () => {
    await writeConfigFile(jwtProfile());
    await writeSessionFile({acme: {accessToken: "at_abc", refreshToken: "rt_xyz"}});

    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    // Should not throw even when the HTTP call fails
    await (logout.run as any)({args: {env: "sandbox", yes: true}, rawArgs: []});

    // Session must be cleared despite the failure
    const sessions = await readSessions();
    expect(sessions.acme).toBeUndefined();
    expect(process.exitCode).toBe(0);

    stdout.mockRestore();
    stderr.mockRestore();
  });

  it("--purgeKey removes the matching secret_key.json entry, leaving other profile/env entries", async () => {
    await writeConfigFile(jwtProfile());
    await writeSessionFile({acme: {accessToken: "at_abc", refreshToken: "rt_xyz"}});
    await writeSdkKeyFile([
      {env: "sandbox", sdkAccessId: "ak_1", apiSecret: "s1", profile: "acme", createdAt: "t1"},
      {env: "production", sdkAccessId: "ak_2", apiSecret: "s2", profile: "acme", createdAt: "t2"},
      {env: "sandbox", sdkAccessId: "ak_3", apiSecret: "s3", profile: "other", createdAt: "t3"}
    ]);

    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await (logout.run as any)({args: {env: "sandbox", yes: true, purgeKey: true}, rawArgs: []});

    // Only acme/sandbox is gone; the other env and the other profile survive.
    const keys = await readSdkKeys();
    expect(keys.map((k) => `${k.profile}/${k.env}`).sort()).toEqual(["acme/production", "other/sandbox"]);

    stdout.mockRestore();
    stderr.mockRestore();
  });

  it("--purgeKey WITHOUT --env removes every SDK key for the profile (all envs), sparing other profiles", async () => {
    await writeConfigFile(jwtProfile());
    await writeSessionFile({acme: {accessToken: "at_abc", refreshToken: "rt_xyz"}});
    await writeSdkKeyFile([
      {env: "sandbox", sdkAccessId: "ak_1", apiSecret: "s1", profile: "acme", createdAt: "t1"},
      {env: "production", sdkAccessId: "ak_2", apiSecret: "s2", profile: "acme", createdAt: "t2"},
      {env: "sandbox", sdkAccessId: "ak_3", apiSecret: "s3", profile: "other", createdAt: "t3"}
    ]);

    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    // No --env → purge all of the profile's keys.
    await (logout.run as any)({args: {yes: true, purgeKey: true}, rawArgs: []});

    // Both acme envs gone; the other profile's key survives.
    const keys = await readSdkKeys();
    expect(keys.map((k) => `${k.profile}/${k.env}`)).toEqual(["other/sandbox"]);

    stdout.mockRestore();
    stderr.mockRestore();
  });

  it("clears the JWT session without an --env flag (env-independent)", async () => {
    await writeConfigFile(jwtProfile());
    await writeSessionFile({acme: {accessToken: "at_abc", refreshToken: "rt_xyz"}});

    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await (logout.run as any)({args: {yes: true}, rawArgs: []});

    expect((await readSessions()).acme).toBeUndefined();
    expect(process.exitCode).toBe(0);

    stdout.mockRestore();
    stderr.mockRestore();
  });

  it("--dryRun shows intent without touching files", async () => {
    await writeConfigFile(jwtProfile());
    await writeSessionFile({acme: {accessToken: "at_abc", refreshToken: "rt_xyz"}});

    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (logout.run as any)({args: {dryRun: true}, rawArgs: []});

    const out = stdout.mock.calls.map((c) => String(c[0])).join("");
    const parsed = JSON.parse(out);
    expect(parsed.action).toBe("logout");
    expect(parsed.willClearJwtTokens).toBe(true);
    expect(parsed.willRevokeRefreshToken).toBe(true);

    // Files untouched
    const sessions = await readSessions();
    expect(sessions.acme.accessToken).toBe("at_abc");
    stdout.mockRestore();
  });
});
