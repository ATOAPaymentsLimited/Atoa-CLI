import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import {promises as fs} from "fs";
import {tmpdir} from "os";
import {join} from "path";

/**
 * Profile commands read/write the local config + keychain directly (no HTTP).
 * We test them against a real tmpdir filesystem via ATOA_HOME.
 *
 * We force the FILE backend by mocking `@napi-rs/keyring` to throw on import —
 * that way `createSecretsStore` falls through its catch and returns `fileStore`
 * on every host, regardless of whether the dev machine has a real keychain.
 */

// Make @napi-rs/keyring unavailable so createSecretsStore returns fileStore.
vi.mock("@napi-rs/keyring", () => {
  throw new Error("keyring not available in tests");
});

import {secretsFilePath} from "../../src/lib/secrets-store";

let scratch: string;
const configPath = () => join(scratch, ".config", "atoa", "config.json");

async function writeConfig(cfg: any): Promise<void> {
  await fs.mkdir(join(scratch, ".config", "atoa"), {recursive: true, mode: 0o700});
  await fs.writeFile(configPath(), JSON.stringify(cfg, null, 2), {mode: 0o600});
}

async function readConfig(): Promise<any> {
  return JSON.parse(await fs.readFile(configPath(), "utf8"));
}

async function readSecrets(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await fs.readFile(secretsFilePath(), "utf8"));
  } catch {
    return {};
  }
}

beforeEach(async () => {
  scratch = await fs.mkdtemp(join(tmpdir(), "atoa-profile-test-"));
  process.env.ATOA_HOME = scratch;
});

afterEach(async () => {
  delete process.env.ATOA_HOME;
  await fs.rm(scratch, {recursive: true, force: true}).catch(() => undefined);
});

import list from "../../src/commands/profile/list";
import show from "../../src/commands/profile/show";
import use from "../../src/commands/profile/use";
import set from "../../src/commands/profile/set";
import rename from "../../src/commands/profile/rename";
import del from "../../src/commands/profile/delete";

describe("profile list", () => {
  it("reports 'no profiles configured' when none exist", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (list.run as any)({args: {}, rawArgs: []});
    const out = stdout.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toMatch(/no profiles configured/);
    stdout.mockRestore();
  });

  it("renders a table including the active profile marker", async () => {
    await writeConfig({
      schemaVersion: 1,
      activeProfile: "acme",
      profiles: {
        acme: {
          businessId: "biz_1",
          displayName: "Acme Ltd",
          defaultEnv: "sandbox",
          envs: {sandbox: {tokenFingerprint: "RlM="}}
        }
      }
    });
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (list.run as any)({args: {}, rawArgs: []});
    const out = stdout.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toMatch(/NAME/);
    expect(out).toMatch(/BUSINESS/);
    expect(out).toMatch(/SANDBOX/);
    expect(out).toMatch(/acme/);
    expect(out).toMatch(/Acme Ltd/);
    expect(out).toMatch(/sandbox/);
    expect(out).toMatch(/…RlM=/);
    // No businessId column (was removed in §6.6 / round-4 cleanup)
    expect(out).not.toMatch(/BUSINESS_ID/);
    stdout.mockRestore();
  });

  it("supports --output json", async () => {
    await writeConfig({
      schemaVersion: 1,
      activeProfile: "acme",
      profiles: {acme: {businessId: "biz_1", displayName: "Acme", envs: {}}}
    });
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (list.run as any)({args: {output: "json"}, rawArgs: []});
    const raw = stdout.mock.calls.map((c) => String(c[0])).join("");
    const parsed = JSON.parse(raw);
    expect(parsed.profiles).toHaveLength(1);
    expect(parsed.profiles[0].name).toBe("acme");
    expect(parsed.profiles[0].active).toBe(true);
    stdout.mockRestore();
  });
});

describe("profile show", () => {
  it("errors with a clear message when no profiles exist", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (show.run as any)({args: {}, rawArgs: []});
    const err = stderr.mock.calls.map((c) => String(c[0])).join("");
    expect(err).toMatch(/no profiles configured/);
    expect(process.exitCode).toBe(4); // not_found kind
    stderr.mockRestore();
    process.exitCode = 0;
  });

  it("shows labeled text for the active profile by default", async () => {
    await writeConfig({
      schemaVersion: 1,
      activeProfile: "vignesh",
      profiles: {vignesh: {businessId: "biz_1", displayName: "VIGNESH", defaultEnv: "sandbox", envs: {}}}
    });
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (show.run as any)({args: {}, rawArgs: []});
    const out = stdout.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toMatch(/profile:\s+vignesh \(active\)/);
    expect(out).toMatch(/business:\s+VIGNESH/);
    expect(out).toMatch(/defaultEnv:\s+sandbox/);
    expect(out).toMatch(/sandbox:\s+not configured/);
    stdout.mockRestore();
  });

  it("supports --output json", async () => {
    await writeConfig({
      schemaVersion: 1,
      activeProfile: "vignesh",
      profiles: {vignesh: {businessId: "biz_1", displayName: "VIGNESH", defaultEnv: "sandbox", envs: {}}}
    });
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (show.run as any)({args: {output: "json"}, rawArgs: []});
    const raw = stdout.mock.calls.map((c) => String(c[0])).join("");
    const parsed = JSON.parse(raw);
    expect(parsed.profile).toBe("vignesh");
    expect(parsed.active).toBe(true);
    expect(parsed.business).toBe("VIGNESH");
    expect(parsed.defaultEnv).toBe("sandbox");
    stdout.mockRestore();
  });
});

describe("profile use", () => {
  it("sets the active profile in config", async () => {
    await writeConfig({
      schemaVersion: 1,
      profiles: {
        acme: {businessId: "b1", displayName: "Acme", envs: {}},
        other: {businessId: "b2", displayName: "Other", envs: {}}
      }
    });
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (use.run as any)({args: {name: "other"}, rawArgs: []});
    const cfg = await readConfig();
    expect(cfg.activeProfile).toBe("other");
    stdout.mockRestore();
  });

  it("--dryRun previews without writing", async () => {
    await writeConfig({
      schemaVersion: 1,
      activeProfile: "acme",
      profiles: {
        acme: {businessId: "b1", displayName: "Acme", envs: {}},
        other: {businessId: "b2", displayName: "Other", envs: {}}
      }
    });
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (use.run as any)({args: {name: "other", dryRun: true}, rawArgs: []});
    const cfg = await readConfig();
    expect(cfg.activeProfile).toBe("acme"); // unchanged
    const out = stdout.mock.calls.map((c) => String(c[0])).join("");
    const parsed = JSON.parse(out);
    expect(parsed).toMatchObject({action: "use", from: "acme", to: "other"});
    stdout.mockRestore();
  });

  it("--dryRun against a non-existent profile reports the error without writing", async () => {
    await writeConfig({
      schemaVersion: 1,
      activeProfile: "acme",
      profiles: {acme: {businessId: "b1", displayName: "Acme", envs: {}}}
    });
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (use.run as any)({args: {name: "nonexistent", dryRun: true}, rawArgs: []});
    const out = stdout.mock.calls.map((c) => String(c[0])).join("");
    const parsed = JSON.parse(out);
    expect(parsed.error).toMatch(/does not exist/);
    stdout.mockRestore();
  });
});

describe("profile set", () => {
  it("rejects malformed assignment (missing =)", async () => {
    await writeConfig({
      schemaVersion: 1,
      activeProfile: "acme",
      profiles: {
        acme: {
          businessId: "b1",
          displayName: "Acme",
          envs: {sandbox: {tokenFingerprint: "x"}, production: {tokenFingerprint: "y"}}
        }
      }
    });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (set.run as any)({args: {assignment: "noequals"}, rawArgs: []});
    expect(process.exitCode).toBe(3);
    stderr.mockRestore();
    process.exitCode = 0;
  });

  it("rejects unknown keys", async () => {
    await writeConfig({
      schemaVersion: 1,
      activeProfile: "acme",
      profiles: {acme: {businessId: "b1", displayName: "Acme", envs: {sandbox: {tokenFingerprint: "x"}}}}
    });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (set.run as any)({args: {assignment: "host=evil.com"}, rawArgs: []});
    const err = stderr.mock.calls.map((c) => String(c[0])).join("");
    expect(err).toMatch(/unknown profile key "host"/);
    expect(process.exitCode).toBe(3);
    stderr.mockRestore();
    process.exitCode = 0;
  });

  it("rejects env values other than sandbox/production", async () => {
    await writeConfig({
      schemaVersion: 1,
      activeProfile: "acme",
      profiles: {acme: {businessId: "b1", displayName: "Acme", envs: {sandbox: {tokenFingerprint: "x"}}}}
    });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (set.run as any)({args: {assignment: "env=staging"}, rawArgs: []});
    const err = stderr.mock.calls.map((c) => String(c[0])).join("");
    expect(err).toMatch(/env must be "sandbox" or "production"/);
    expect(process.exitCode).toBe(3);
    stderr.mockRestore();
    process.exitCode = 0;
  });

  it("rejects switching to an env with no credentials", async () => {
    await writeConfig({
      schemaVersion: 1,
      activeProfile: "acme",
      profiles: {
        acme: {businessId: "b1", displayName: "Acme", defaultEnv: "sandbox", envs: {sandbox: {tokenFingerprint: "x"}}}
      }
    });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (set.run as any)({args: {assignment: "env=production", yes: true}, rawArgs: []});
    const err = stderr.mock.calls.map((c) => String(c[0])).join("");
    expect(err).toMatch(/has no production credentials/);
    expect(process.exitCode).toBe(3);
    stderr.mockRestore();
    process.exitCode = 0;
  });

  it("no-ops when the new env equals the current default", async () => {
    await writeConfig({
      schemaVersion: 1,
      activeProfile: "acme",
      profiles: {
        acme: {businessId: "b1", displayName: "Acme", defaultEnv: "sandbox", envs: {sandbox: {tokenFingerprint: "x"}}}
      }
    });
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (set.run as any)({args: {assignment: "env=sandbox", yes: true}, rawArgs: []});
    const out = stdout.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toMatch(/already defaults to sandbox/);
    stdout.mockRestore();
  });

  it("writes the new defaultEnv with --yes", async () => {
    await writeConfig({
      schemaVersion: 1,
      activeProfile: "acme",
      profiles: {
        acme: {
          businessId: "b1",
          displayName: "Acme",
          defaultEnv: "sandbox",
          envs: {sandbox: {tokenFingerprint: "x"}, production: {tokenFingerprint: "y"}}
        }
      }
    });
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (set.run as any)({args: {assignment: "env=production", yes: true}, rawArgs: []});
    const cfg = await readConfig();
    expect(cfg.profiles.acme.defaultEnv).toBe("production");
    stdout.mockRestore();
  });

  it("--dryRun previews without writing", async () => {
    await writeConfig({
      schemaVersion: 1,
      activeProfile: "acme",
      profiles: {
        acme: {
          businessId: "b1",
          displayName: "Acme",
          defaultEnv: "sandbox",
          envs: {sandbox: {tokenFingerprint: "x"}, production: {tokenFingerprint: "y"}}
        }
      }
    });
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (set.run as any)({args: {assignment: "env=production", dryRun: true}, rawArgs: []});
    const cfg = await readConfig();
    expect(cfg.profiles.acme.defaultEnv).toBe("sandbox"); // unchanged
    const out = stdout.mock.calls.map((c) => String(c[0])).join("");
    const parsed = JSON.parse(out);
    expect(parsed).toMatchObject({action: "profile-set", from: "sandbox", to: "production"});
    stdout.mockRestore();
  });
});

describe("profile rename", () => {
  it("rejects names that don't match the slug regex", async () => {
    await writeConfig({
      schemaVersion: 1,
      profiles: {acme: {businessId: "b1", displayName: "Acme", envs: {}}}
    });
    const cases = ["UPPERCASE", "has space", "acme:sandbox", "../bad", "", "-leading", "trailing-", "double--hyphen"];
    for (const newName of cases) {
      const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      await (rename.run as any)({args: {oldName: "acme", newName}, rawArgs: []});
      const err = stderr.mock.calls.map((c) => String(c[0])).join("");
      expect(err, `should reject "${newName}"`).toMatch(/invalid/);
      stderr.mockRestore();
      process.exitCode = 0;
    }
  });

  it("accepts valid slug names in --dryRun and reports no rewrite", async () => {
    await writeConfig({
      schemaVersion: 1,
      profiles: {acme: {businessId: "b1", displayName: "Acme", envs: {}}}
    });
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (rename.run as any)({args: {oldName: "acme", newName: "acme-uk", dryRun: true}, rawArgs: []});
    const cfg = await readConfig();
    expect(cfg.profiles).toHaveProperty("acme"); // unchanged
    expect(cfg.profiles).not.toHaveProperty("acme-uk");
    const out = stdout.mock.calls.map((c) => String(c[0])).join("");
    const parsed = JSON.parse(out);
    expect(parsed).toMatchObject({action: "rename", from: "acme", to: "acme-uk"});
    stdout.mockRestore();
  });

  it("renames + re-keys keychain slots with --yes", async () => {
    await writeConfig({
      schemaVersion: 1,
      activeProfile: "acme",
      profiles: {acme: {businessId: "b1", displayName: "Acme", envs: {sandbox: {tokenFingerprint: "x"}}}}
    });
    // Pre-stage a token
    await fs.mkdir(join(scratch, ".config", "atoa"), {recursive: true, mode: 0o700});
    await fs.writeFile(secretsFilePath(), JSON.stringify({"acme:sandbox": "sb-token"}), {mode: 0o600});

    await (rename.run as any)({args: {oldName: "acme", newName: "acme-uk", yes: true}, rawArgs: []});
    const cfg = await readConfig();
    expect(cfg.profiles).toHaveProperty("acme-uk");
    expect(cfg.profiles).not.toHaveProperty("acme");
    expect(cfg.activeProfile).toBe("acme-uk"); // pointer follows

    const secrets = await readSecrets();
    expect(secrets["acme-uk:sandbox"]).toBe("sb-token");
    expect(secrets["acme:sandbox"]).toBeUndefined();
  });

  it("no-op when oldName === newName", async () => {
    await writeConfig({
      schemaVersion: 1,
      profiles: {acme: {businessId: "b1", displayName: "Acme", envs: {}}}
    });
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (rename.run as any)({args: {oldName: "acme", newName: "acme"}, rawArgs: []});
    const out = stdout.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toMatch(/identical/);
    stdout.mockRestore();
  });
});

describe("profile delete", () => {
  it("--dryRun previews without removing", async () => {
    await writeConfig({
      schemaVersion: 1,
      profiles: {acme: {businessId: "b1", displayName: "Acme", envs: {sandbox: {tokenFingerprint: "x"}}}}
    });
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (del.run as any)({args: {name: "acme", dryRun: true}, rawArgs: []});
    const cfg = await readConfig();
    expect(cfg.profiles).toHaveProperty("acme"); // unchanged
    const out = stdout.mock.calls.map((c) => String(c[0])).join("");
    const parsed = JSON.parse(out);
    expect(parsed).toMatchObject({action: "delete", profile: "acme", willRemoveConfigEntry: true});
    expect(parsed.willRemoveSlots).toContain("sandbox");
    stdout.mockRestore();
  });

  it("--yes removes config entry and clears slots", async () => {
    await writeConfig({
      schemaVersion: 1,
      profiles: {acme: {businessId: "b1", displayName: "Acme", envs: {sandbox: {tokenFingerprint: "x"}}}}
    });
    await fs.mkdir(join(scratch, ".config", "atoa"), {recursive: true, mode: 0o700});
    await fs.writeFile(secretsFilePath(), JSON.stringify({"acme:sandbox": "tk"}), {mode: 0o600});

    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (del.run as any)({args: {name: "acme", yes: true}, rawArgs: []});
    const cfg = await readConfig();
    expect(cfg.profiles).not.toHaveProperty("acme");
    const secrets = await readSecrets();
    expect(secrets["acme:sandbox"]).toBeUndefined();
    stdout.mockRestore();
  });

  it("scrubs orphaned secret slots even when config entry is absent", async () => {
    await writeConfig({schemaVersion: 1, profiles: {}});
    await fs.mkdir(join(scratch, ".config", "atoa"), {recursive: true, mode: 0o700});
    await fs.writeFile(secretsFilePath(), JSON.stringify({"orphan:sandbox": "tk"}), {mode: 0o600});

    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (del.run as any)({args: {name: "orphan"}, rawArgs: []});
    const secrets = await readSecrets();
    expect(secrets["orphan:sandbox"]).toBeUndefined();
    stdout.mockRestore();
  });
});
