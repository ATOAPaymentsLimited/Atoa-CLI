import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import {promises as fs} from "fs";
import {tmpdir} from "os";
import {join} from "path";

import {sessionFilePath, authDir} from "../../src/lib/secrets-store";
import {configFilePath} from "../../src/lib/config-store";

// logoutJwt does a best-effort server revoke via its OWN http client. Stub lib/http so tests never
// touch a real network (localhost:9090) — a rejected request is exactly the "revoke failed, proceed
// with local cleanup" path the tests assert.
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
  scratch = await fs.mkdtemp(join(tmpdir(), "atoa-logout-test-"));
  process.env.ATOA_HOME = scratch;
});

afterEach(async () => {
  delete process.env.ATOA_HOME;
  await fs.rm(scratch, {recursive: true, force: true}).catch(() => undefined);
  process.exitCode = 0;
});

async function writeConfig(cfg: unknown): Promise<void> {
  await fs.mkdir(join(scratch, ".config", "atoa"), {recursive: true, mode: 0o700});
  await fs.writeFile(configFilePath(), JSON.stringify(cfg, null, 2), {mode: 0o600});
}

/** Write the JWT session file ({sessions: {"<profile>": {...}}}). */
async function writeSession(sessions: Record<string, {accessToken: string; refreshToken: string}>): Promise<void> {
  await fs.mkdir(authDir(), {recursive: true, mode: 0o700});
  await fs.writeFile(sessionFilePath(), JSON.stringify({sessions}), {mode: 0o600});
}

async function readSessions(): Promise<Record<string, {accessToken: string; refreshToken: string}>> {
  return JSON.parse(await fs.readFile(sessionFilePath(), "utf8")).sessions;
}

/** A JWT-mode profile config. */
function jwtConfig(envs: Record<string, {authMode: "jwt"; tokenFingerprint: string}>, defaultEnv: string) {
  return {
    schemaVersion: 1,
    activeProfile: "acme",
    profiles: {
      acme: {businessId: "b1", displayName: "Acme", defaultEnv, envs}
    }
  };
}

describe("atoa logout", () => {
  it("prints 'already clear' when no profiles exist", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (logout.run as any)({args: {}, rawArgs: []});
    const out = stdout.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toMatch(/no profiles to log out/);
    stdout.mockRestore();
  });

  it("--dryRun shows JWT intent without touching the session file", async () => {
    await writeConfig(
      jwtConfig(
        {
          sandbox: {authMode: "jwt", tokenFingerprint: "x"},
          production: {authMode: "jwt", tokenFingerprint: "y"}
        },
        "production"
      )
    );
    await writeSession({
      acme: {accessToken: "at-1", refreshToken: "rt-1"}
    });

    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (logout.run as any)({args: {dryRun: true}, rawArgs: []});

    const out = stdout.mock.calls.map((c) => String(c[0])).join("");
    const parsed = JSON.parse(out);
    expect(parsed).toMatchObject({
      action: "logout",
      profile: "acme",
      willRevokeRefreshToken: true,
      willClearJwtTokens: true
    });

    // Session file untouched
    const sessions = await readSessions();
    expect(sessions.acme.refreshToken).toBe("rt-1");
    stdout.mockRestore();
  });

  it("--yes + --env clears the profile's (env-independent) JWT session", async () => {
    await writeConfig(
      jwtConfig(
        {
          sandbox: {authMode: "jwt", tokenFingerprint: "x"},
          production: {authMode: "jwt", tokenFingerprint: "y"}
        },
        "sandbox"
      )
    );
    // JWT sessions are env-independent — one session per profile.
    await writeSession({
      acme: {accessToken: "at-1", refreshToken: "rt-1"}
    });

    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (logout.run as any)({args: {env: "sandbox", yes: true}, rawArgs: []});

    const sessions = await readSessions();
    expect(sessions.acme).toBeUndefined();

    stdout.mockRestore();
    stderr.mockRestore();
  });

  it("is a no-op when the profile has no JWT session (nothing to clear)", async () => {
    await writeConfig(jwtConfig({sandbox: {authMode: "jwt", tokenFingerprint: "x"}}, "sandbox"));
    // No session written → nothing to clear.
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (logout.run as any)({args: {yes: true}, rawArgs: []});
    const out = stdout.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toMatch(/already logged out|nothing to clear/);
    stdout.mockRestore();
  });
});
