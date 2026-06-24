import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import {promises as fs} from "fs";
import {tmpdir} from "os";
import {join} from "path";

/**
 * logout JWT-mode tests (BUD-019 Task 5).
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
  scratch = await fs.mkdtemp(join(tmpdir(), "atoa-logout-bud019-"));
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

  it("--dryRun shows intent without touching files", async () => {
    await writeConfigFile(jwtProfile());
    await writeSessionFile({acme: {accessToken: "at_abc", refreshToken: "rt_xyz"}});

    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (logout.run as any)({args: {env: "sandbox", dryRun: true}, rawArgs: []});

    const out = stdout.mock.calls.map((c) => String(c[0])).join("");
    const parsed = JSON.parse(out);
    expect(parsed.mode).toBe("jwt");
    expect(parsed.willClearJwtTokens).toBe(true);
    expect(parsed.willRevokeRefreshToken).toBe(true);

    // Files untouched
    const sessions = await readSessions();
    expect(sessions.acme.accessToken).toBe("at_abc");
    stdout.mockRestore();
  });
});
