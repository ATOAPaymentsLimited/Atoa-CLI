import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import {promises as fs} from "fs";
import {tmpdir} from "os";
import {join} from "path";

import {sessionFilePath, configHomeDir, authDir} from "../../src/lib/secrets-store";
import {sdkKeyFilePath} from "../../src/lib/sdk-key-file";
import {configFilePath} from "../../src/lib/config-store";
import reset from "../../src/commands/reset";

let scratch: string;

beforeEach(async () => {
  scratch = await fs.mkdtemp(join(tmpdir(), "atoa-reset-test-"));
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

/** Write the JWT session file ({sessions: {"profile:env": {...}}}). */
async function writeSession(sessions: Record<string, {accessToken: string; refreshToken: string}>): Promise<void> {
  await fs.mkdir(authDir(), {recursive: true, mode: 0o700});
  await fs.writeFile(sessionFilePath(), JSON.stringify({sessions}), {mode: 0o600});
}

/** Write the SDK key file ({keys: [...]}). */
async function writeSdkKeys(keys: unknown[]): Promise<void> {
  await fs.mkdir(authDir(), {recursive: true, mode: 0o700});
  await fs.writeFile(sdkKeyFilePath(), JSON.stringify({keys}), {mode: 0o600});
}

describe("atoa reset", () => {
  it("prints 'Nothing to clear' when no profiles AND no files exist", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (reset.run as any)({args: {yes: true}, rawArgs: []});
    const out = stdout.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toMatch(/Nothing to clear/);
    stdout.mockRestore();
  });

  it("--dryRun lists profiles + all three wiped files without touching disk", async () => {
    await writeConfig({
      schemaVersion: 1,
      activeProfile: "acme",
      profiles: {
        acme: {
          businessId: "b1",
          displayName: "Acme",
          envs: {
            sandbox: {tokenFingerprint: "x", authMode: "jwt"},
            production: {tokenFingerprint: "y", authMode: "jwt"}
          }
        }
      }
    });
    await writeSession({"acme:sandbox": {accessToken: "at", refreshToken: "rt"}});

    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (reset.run as any)({args: {dryRun: true, revoke: true}, rawArgs: []});

    const out = stdout.mock.calls.map((c) => String(c[0])).join("");
    const parsed = JSON.parse(out);
    expect(parsed.action).toBe("reset");
    expect(parsed.willClearProfiles).toEqual(["acme"]);
    // All three credential files are wiped: config, JWT session, SDK keys.
    expect(parsed.willWipeFiles).toEqual([configFilePath(), sessionFilePath(), sdkKeyFilePath()]);
    // --revoke lists each configured env, but JWT profiles carry no sdkAccessId,
    // so the actual revoke call is skipped for every target.
    expect(parsed.willRevoke).toHaveLength(2); // sandbox + production
    expect(parsed.willRevoke.every((t: any) => t.sdkAccessId === undefined)).toBe(true);

    // Files untouched
    const cfgStillThere = await fs.stat(configFilePath());
    expect(cfgStillThere.isFile()).toBe(true);
    stdout.mockRestore();
  });

  it("--dryRun without --revoke reports empty revoke list", async () => {
    await writeConfig({
      schemaVersion: 1,
      profiles: {
        acme: {businessId: "b1", displayName: "Acme", envs: {sandbox: {tokenFingerprint: "x", authMode: "jwt"}}}
      }
    });
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (reset.run as any)({args: {dryRun: true}, rawArgs: []});
    const out = stdout.mock.calls.map((c) => String(c[0])).join("");
    const parsed = JSON.parse(out);
    expect(parsed.willRevoke).toEqual([]);
    stdout.mockRestore();
  });

  it("--yes wipes config file + session file + SDK key file", async () => {
    await writeConfig({
      schemaVersion: 1,
      activeProfile: "acme",
      profiles: {
        acme: {businessId: "b1", displayName: "Acme", envs: {sandbox: {tokenFingerprint: "x", authMode: "jwt"}}}
      }
    });
    await writeSession({"acme:sandbox": {accessToken: "at", refreshToken: "rt"}});
    await writeSdkKeys([{env: "SANDBOX", sdkAccessId: "sda", apiSecret: "s", profile: "acme", createdAt: "now"}]);

    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (reset.run as any)({args: {yes: true}, rawArgs: []});

    await expect(fs.access(configFilePath())).rejects.toThrow();
    await expect(fs.access(sessionFilePath())).rejects.toThrow();
    await expect(fs.access(sdkKeyFilePath())).rejects.toThrow();
    const out = stdout.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toMatch(/Cleared 1 profile/);
    stdout.mockRestore();
  });

  it("handles corrupt config gracefully (still wipes files)", async () => {
    await fs.mkdir(join(scratch, ".config", "atoa"), {recursive: true, mode: 0o700});
    await fs.writeFile(configFilePath(), "{ definitely not json", {mode: 0o600});
    await writeSession({"acme:sandbox": {accessToken: "at", refreshToken: "rt"}});
    await writeSdkKeys([{env: "SANDBOX", sdkAccessId: "sda", apiSecret: "s", profile: "acme", createdAt: "now"}]);

    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (reset.run as any)({args: {yes: true}, rawArgs: []});

    await expect(fs.access(configFilePath())).rejects.toThrow();
    await expect(fs.access(sessionFilePath())).rejects.toThrow();
    await expect(fs.access(sdkKeyFilePath())).rejects.toThrow();
    stderr.mockRestore();
    stdout.mockRestore();
  });

  it("uses ATOA_HOME for the wipe targets", () => {
    // Sanity check: configHomeDir() should match the scratch we set up.
    expect(configHomeDir()).toBe(scratch);
  });
});
