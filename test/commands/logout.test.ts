import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import {promises as fs} from "fs";
import {tmpdir} from "os";
import {join} from "path";

// Force file backend in tests — mocked at the secrets-store layer because
// the source loads @napi-rs/keyring via require(), which bypasses vi.mock.
vi.mock("../../src/lib/secrets-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/secrets-store")>();
  const {buildFileSecretsStore} = await import("../helpers/file-store-mock");
  return {
    ...actual,
    createSecretsStore: async () => buildFileSecretsStore(actual.secretsFilePath)
  };
});

import {secretsFilePath} from "../../src/lib/secrets-store";
import {configFilePath, readConfig} from "../../src/lib/config-store";
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

async function writeSecrets(slots: Record<string, string>): Promise<void> {
  await fs.mkdir(join(scratch, ".config", "atoa"), {recursive: true, mode: 0o700});
  await fs.writeFile(secretsFilePath(), JSON.stringify(slots), {mode: 0o600});
}

describe("atoa logout", () => {
  it("prints 'already clear' when no profiles exist", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (logout.run as any)({args: {}, rawArgs: []});
    const out = stdout.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toMatch(/no profiles to log out/);
    stdout.mockRestore();
  });

  it("--dryRun shows what would be cleared without touching state", async () => {
    await writeConfig({
      schemaVersion: 1,
      activeProfile: "acme",
      profiles: {
        acme: {
          businessId: "b1",
          displayName: "Acme",
          defaultEnv: "production",
          envs: {
            sandbox: {sdkAccessId: "sda_sb", tokenFingerprint: "x"},
            production: {sdkAccessId: "sda_prod", tokenFingerprint: "y"}
          }
        }
      }
    });
    await writeSecrets({"acme:sandbox": "tk-sb", "acme:production": "tk-prod"});

    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (logout.run as any)({args: {env: "production", revoke: true, dryRun: true}, rawArgs: []});

    const out = stdout.mock.calls.map((c) => String(c[0])).join("");
    const parsed = JSON.parse(out);
    expect(parsed).toMatchObject({
      action: "logout",
      profile: "acme",
      env: "production",
      willClearKeychainSlot: true,
      willClearConfigEntry: true,
      willRevokeServerSide: true,
      sdkAccessId: "sda_prod"
    });
    expect(parsed.remainingEnvsAfter).toEqual(["sandbox"]);

    // Files untouched
    const secrets = JSON.parse(await fs.readFile(secretsFilePath(), "utf8"));
    expect(secrets["acme:production"]).toBe("tk-prod");
    stdout.mockRestore();
  });

  it("--dryRun reports remainingEnvsAfter as empty when last env is being removed", async () => {
    await writeConfig({
      schemaVersion: 1,
      activeProfile: "acme",
      profiles: {
        acme: {
          businessId: "b1",
          displayName: "Acme",
          defaultEnv: "sandbox",
          envs: {sandbox: {sdkAccessId: "sda_sb", tokenFingerprint: "x"}}
        }
      }
    });
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (logout.run as any)({args: {env: "sandbox", dryRun: true}, rawArgs: []});
    const out = stdout.mock.calls.map((c) => String(c[0])).join("");
    const parsed = JSON.parse(out);
    expect(parsed.remainingEnvsAfter).toEqual([]);
    stdout.mockRestore();
  });

  it("--yes + --env clears the slot + config entry for that env only", async () => {
    await writeConfig({
      schemaVersion: 1,
      activeProfile: "acme",
      profiles: {
        acme: {
          businessId: "b1",
          displayName: "Acme",
          defaultEnv: "sandbox",
          envs: {
            sandbox: {sdkAccessId: "sda_sb", tokenFingerprint: "x"},
            production: {sdkAccessId: "sda_prod", tokenFingerprint: "y"}
          }
        }
      }
    });
    await writeSecrets({"acme:sandbox": "tk-sb", "acme:production": "tk-prod"});

    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (logout.run as any)({args: {env: "sandbox", yes: true}, rawArgs: []});

    const secrets = JSON.parse(await fs.readFile(secretsFilePath(), "utf8"));
    expect(secrets["acme:sandbox"]).toBeUndefined();
    expect(secrets["acme:production"]).toBe("tk-prod");

    const cfg = await readConfig();
    expect(cfg.profiles.acme.envs.sandbox).toBeUndefined();
    expect(cfg.profiles.acme.envs.production).toBeDefined();

    stdout.mockRestore();
  });

  it("promotes the survivor env to defaultEnv when one env remains", async () => {
    await writeConfig({
      schemaVersion: 1,
      activeProfile: "acme",
      profiles: {
        acme: {
          businessId: "b1",
          displayName: "Acme",
          defaultEnv: "production",
          envs: {
            sandbox: {sdkAccessId: "sda_sb", tokenFingerprint: "x"},
            production: {sdkAccessId: "sda_prod", tokenFingerprint: "y"}
          }
        }
      }
    });
    await writeSecrets({"acme:sandbox": "tk-sb", "acme:production": "tk-prod"});

    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (logout.run as any)({args: {env: "production", yes: true}, rawArgs: []});

    const cfg = await readConfig();
    expect(cfg.profiles.acme.defaultEnv).toBe("sandbox"); // promoted
    stdout.mockRestore();
  });

  it("removes the profile entry entirely when the last env is logged out", async () => {
    await writeConfig({
      schemaVersion: 1,
      activeProfile: "acme",
      profiles: {
        acme: {
          businessId: "b1",
          displayName: "Acme",
          defaultEnv: "sandbox",
          envs: {sandbox: {sdkAccessId: "sda_sb", tokenFingerprint: "x"}}
        }
      }
    });
    await writeSecrets({"acme:sandbox": "tk-sb"});

    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (logout.run as any)({args: {env: "sandbox", yes: true}, rawArgs: []});

    const cfg = await readConfig();
    expect(cfg.profiles).not.toHaveProperty("acme");
    stdout.mockRestore();
  });

  it("already-cleared env is a no-op", async () => {
    await writeConfig({
      schemaVersion: 1,
      activeProfile: "acme",
      profiles: {
        acme: {
          businessId: "b1",
          displayName: "Acme",
          defaultEnv: "sandbox",
          envs: {sandbox: {sdkAccessId: "sda_sb", tokenFingerprint: "x"}}
        }
      }
    });
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (logout.run as any)({args: {env: "production", yes: true}, rawArgs: []});
    const out = stdout.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toMatch(/already cleared/);
    stdout.mockRestore();
  });
});
