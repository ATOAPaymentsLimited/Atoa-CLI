import {describe, it, expect, beforeEach, afterEach} from "vitest";
import {promises as fs} from "fs";
import {tmpdir} from "os";
import {join} from "path";
import {readConfig, writeConfig, configFilePath, newProfile, type ProfileConfig} from "../../src/lib/config-store";

let tmpHome: string;
const origAtoaHome = process.env.ATOA_HOME;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(join(tmpdir(), "atoa-cfg-"));
  process.env.ATOA_HOME = tmpHome;
});

afterEach(async () => {
  if (origAtoaHome === undefined) delete process.env.ATOA_HOME;
  else process.env.ATOA_HOME = origAtoaHome;
  await fs.rm(tmpHome, {recursive: true, force: true});
});

function makeProfile(overrides: Partial<ProfileConfig> = {}): ProfileConfig {
  const base = newProfile({businessId: "biz_1", displayName: "Test Co"});
  return {...base, ...overrides};
}

describe("readConfig", () => {
  it("returns an empty schema-stamped config when the file does not exist", async () => {
    expect(await readConfig()).toEqual({schemaVersion: 1, profiles: {}});
  });

  it("reads back what writeConfig wrote", async () => {
    const cfg = {schemaVersion: 1 as const, profiles: {p1: makeProfile()}};
    await writeConfig(cfg);
    const got = await readConfig();
    expect(got.schemaVersion).toBe(1);
    expect(got.profiles.p1.businessId).toBe("biz_1");
  });

  it("round-trips via the resolved configFilePath", async () => {
    await writeConfig({schemaVersion: 1, profiles: {p1: makeProfile()}});
    const raw = await fs.readFile(configFilePath(), "utf8");
    expect(JSON.parse(raw).schemaVersion).toBe(1);
  });

  it("throws a friendly error with the file path for invalid JSON", async () => {
    await fs.mkdir(join(tmpHome, ".config", "atoa"), {recursive: true});
    await fs.writeFile(configFilePath(), "{ not valid json", "utf8");
    await expect(readConfig()).rejects.toThrow(/invalid JSON/);
  });
});
