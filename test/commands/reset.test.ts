import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import {promises as fs} from "fs";
import {tmpdir} from "os";
import {join} from "path";

// Force the file backend so the test works on hosts with real keychains.
vi.mock("@napi-rs/keyring", () => {
  throw new Error("keyring not available in tests");
});

import {secretsFilePath, configHomeDir} from "../../src/lib/secrets-store";
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

describe("atoa reset", () => {
  it("prints 'Nothing to clear' when no profiles AND no files exist", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (reset.run as any)({args: {yes: true}, rawArgs: []});
    const out = stdout.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toMatch(/Nothing to clear/);
    stdout.mockRestore();
  });

  it("--dryRun lists profiles + files + revoke targets without touching disk", async () => {
    await writeConfig({
      schemaVersion: 1,
      activeProfile: "acme",
      profiles: {
        acme: {
          businessId: "b1",
          displayName: "Acme",
          envs: {
            sandbox: {sdkAccessId: "sda_sb", tokenFingerprint: "x"},
            production: {sdkAccessId: "sda_prod", tokenFingerprint: "y"}
          }
        }
      }
    });
    await fs.writeFile(secretsFilePath(), JSON.stringify({"acme:sandbox": "tk"}), {mode: 0o600});

    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (reset.run as any)({args: {dryRun: true, revoke: true}, rawArgs: []});

    const out = stdout.mock.calls.map((c) => String(c[0])).join("");
    const parsed = JSON.parse(out);
    expect(parsed.action).toBe("reset");
    expect(parsed.willClearProfiles).toEqual(["acme"]);
    expect(parsed.willRevoke).toHaveLength(2); // sandbox + production
    expect(parsed.willRevoke.some((t: any) => t.env === "sandbox" && t.sdkAccessId === "sda_sb")).toBe(true);
    expect(parsed.willRevoke.some((t: any) => t.env === "production" && t.sdkAccessId === "sda_prod")).toBe(true);

    // Files untouched
    const cfgStillThere = await fs.stat(configFilePath());
    expect(cfgStillThere.isFile()).toBe(true);
    stdout.mockRestore();
  });

  it("--dryRun without --revoke reports empty revoke list", async () => {
    await writeConfig({
      schemaVersion: 1,
      profiles: {acme: {businessId: "b1", displayName: "Acme", envs: {sandbox: {tokenFingerprint: "x"}}}}
    });
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (reset.run as any)({args: {dryRun: true}, rawArgs: []});
    const out = stdout.mock.calls.map((c) => String(c[0])).join("");
    const parsed = JSON.parse(out);
    expect(parsed.willRevoke).toEqual([]);
    stdout.mockRestore();
  });

  it("--yes wipes config file + secrets file + keychain slots", async () => {
    await writeConfig({
      schemaVersion: 1,
      activeProfile: "acme",
      profiles: {acme: {businessId: "b1", displayName: "Acme", envs: {sandbox: {tokenFingerprint: "x"}}}}
    });
    await fs.writeFile(secretsFilePath(), JSON.stringify({"acme:sandbox": "tk"}), {mode: 0o600});

    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (reset.run as any)({args: {yes: true}, rawArgs: []});

    await expect(fs.access(configFilePath())).rejects.toThrow();
    await expect(fs.access(secretsFilePath())).rejects.toThrow();
    const out = stdout.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toMatch(/Cleared 1 profile/);
    stdout.mockRestore();
  });

  it("handles corrupt config gracefully (still wipes files)", async () => {
    await fs.mkdir(join(scratch, ".config", "atoa"), {recursive: true, mode: 0o700});
    await fs.writeFile(configFilePath(), "{ definitely not json", {mode: 0o600});
    await fs.writeFile(secretsFilePath(), "also broken", {mode: 0o600});

    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (reset.run as any)({args: {yes: true}, rawArgs: []});

    await expect(fs.access(configFilePath())).rejects.toThrow();
    await expect(fs.access(secretsFilePath())).rejects.toThrow();
    stderr.mockRestore();
    stdout.mockRestore();
  });

  it("uses ATOA_HOME for the wipe targets", () => {
    // Sanity check: configHomeDir() should match the scratch we set up.
    expect(configHomeDir()).toBe(scratch);
  });
});
