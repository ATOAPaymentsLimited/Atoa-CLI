import {describe, it, expect, beforeEach, afterEach} from "vitest";
import {promises as fs} from "fs";
import {tmpdir} from "os";
import {join} from "path";
import {
  deriveProfileName,
  resolveActiveProfile,
  slugifyBusinessName,
  writeConfig,
  writeProfile,
  setActiveProfile,
  deleteProfile,
  readConfig
} from "../../src/lib/config-store";

let tmpHome: string;
const origAtoaHome = process.env.ATOA_HOME;
const origAtoaProfile = process.env.ATOA_PROFILE;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(join(tmpdir(), "atoa-prof-"));
  process.env.ATOA_HOME = tmpHome;
  delete process.env.ATOA_PROFILE;
});

afterEach(async () => {
  if (origAtoaHome === undefined) delete process.env.ATOA_HOME;
  else process.env.ATOA_HOME = origAtoaHome;
  if (origAtoaProfile === undefined) delete process.env.ATOA_PROFILE;
  else process.env.ATOA_PROFILE = origAtoaProfile;
  await fs.rm(tmpHome, {recursive: true, force: true});
});

describe("slugifyBusinessName", () => {
  it("lowercases and replaces non-alphanumerics with -", () => {
    expect(slugifyBusinessName("Acme Coffee Ltd", "mid_abc123")).toBe("acme-coffee-ltd");
    expect(slugifyBusinessName("The Bakery", "mid_xyz")).toBe("the-bakery");
  });

  it("collapses consecutive separators and trims edges", () => {
    expect(slugifyBusinessName("  Acme & Coffee!!! ", "mid_x")).toBe("acme-coffee");
    expect(slugifyBusinessName("---Foo---Bar---", "mid_x")).toBe("foo-bar");
  });

  it("strips emoji and other unicode", () => {
    expect(slugifyBusinessName("🎉 Café & Co", "mid_x")).toBe("caf-co");
  });

  it("falls back to business-<last6 alnum> when slug is empty", () => {
    // strip non-alnum → midabcc123zz → slice(-6) → c123zz → lowercase
    expect(slugifyBusinessName("🎉🎉🎉", "mid-abc-c123zz")).toBe("business-c123zz");
    // strip non-alnum → midFFFEEE → slice(-6) → FFFEEE → lowercase
    expect(slugifyBusinessName("🎉🎉", "mid_FFFEEE")).toBe("business-fffeee");
  });

  it('handles a businessId with no alphanumerics by falling back to "unknown"', () => {
    expect(slugifyBusinessName("", "!!!")).toBe("business-unknown");
  });
});

describe("deriveProfileName", () => {
  it("returns the explicit override when provided, trimmed", async () => {
    expect(await deriveProfileName({explicit: "  custom-name  ", businessName: "X", businessId: "m1"})).toBe(
      "custom-name"
    );
  });

  it("returns the slug when no existing profile claims it", async () => {
    expect(await deriveProfileName({businessName: "Acme Coffee", businessId: "mid_abc"})).toBe("acme-coffee");
  });

  it("returns the slug unchanged when the same merchant re-pairs", async () => {
    await writeProfile("acme-coffee", {businessId: "mid_abc123"});
    expect(await deriveProfileName({businessName: "Acme Coffee", businessId: "mid_abc123"})).toBe("acme-coffee");
  });

  it("appends -<last6 of businessId> on collision with a different merchant", async () => {
    await writeProfile("acme-coffee", {businessId: "mid_OWNER1"});
    expect(await deriveProfileName({businessName: "Acme Coffee", businessId: "mid_OTHER_xyz789"})).toBe(
      "acme-coffee-xyz789"
    );
  });

  it("errors when both the base and suffixed slug are owned by other merchants", async () => {
    await writeProfile("acme", {businessId: "mid_A"});
    await writeProfile("acme-abcdef", {businessId: "mid_B"});
    await expect(deriveProfileName({businessName: "Acme", businessId: "mid_other_abcdef"})).rejects.toThrow(
      /collision/
    );
  });
});

describe("resolveActiveProfile", () => {
  it("returns kind=none when no profiles exist", async () => {
    const r = await resolveActiveProfile();
    expect(r.kind).toBe("none");
  });

  it("silently picks the sole profile when no flag/env/activeProfile is set", async () => {
    await writeProfile("only", {businessId: "m1"});
    const r = await resolveActiveProfile();
    expect(r).toMatchObject({kind: "ok", name: "only"});
  });

  it("returns kind=ambiguous when multiple profiles exist and none is active", async () => {
    await writeProfile("one", {businessId: "m1"});
    await writeProfile("two", {businessId: "m2"});
    const r = await resolveActiveProfile();
    expect(r.kind).toBe("ambiguous");
    if (r.kind === "ambiguous") expect(r.names.sort()).toEqual(["one", "two"]);
  });

  it("respects --profile flag", async () => {
    await writeProfile("one", {businessId: "m1"});
    await writeProfile("two", {businessId: "m2"});
    const r = await resolveActiveProfile("two");
    expect(r).toMatchObject({kind: "ok", name: "two"});
  });

  it("respects $ATOA_PROFILE env when no flag is given", async () => {
    await writeProfile("one", {businessId: "m1"});
    await writeProfile("two", {businessId: "m2"});
    process.env.ATOA_PROFILE = "one";
    const r = await resolveActiveProfile();
    expect(r).toMatchObject({kind: "ok", name: "one"});
  });

  it("flag beats env, env beats activeProfile", async () => {
    await writeProfile("a", {businessId: "m1"});
    await writeProfile("b", {businessId: "m2"});
    await writeProfile("c", {businessId: "m3"});
    await setActiveProfile("a");
    process.env.ATOA_PROFILE = "b";
    expect(
      (await resolveActiveProfile()).kind === "ok" && ((await resolveActiveProfile()) as {name: string}).name
    ).toBe("b");
    const r = await resolveActiveProfile("c");
    expect(r).toMatchObject({kind: "ok", name: "c"});
  });

  it("throws when the requested profile does not exist", async () => {
    await writeProfile("one", {businessId: "m1"});
    await expect(resolveActiveProfile("nope")).rejects.toThrow(/No profile named/);
  });
});

describe("deleteProfile", () => {
  it("removes the profile and clears activeProfile when it pointed at the deleted one", async () => {
    await writeProfile("only", {businessId: "m1"});
    await setActiveProfile("only");
    const removed = await deleteProfile("only");
    expect(removed).toBe(true);
    const cfg = await readConfig();
    expect(cfg.profiles).toEqual({});
    expect(cfg.activeProfile).toBeUndefined();
  });

  it("returns false when the profile does not exist", async () => {
    expect(await deleteProfile("ghost")).toBe(false);
  });

  it("preserves activeProfile when deleting a different one", async () => {
    await writeProfile("a", {businessId: "m1"});
    await writeProfile("b", {businessId: "m2"});
    await setActiveProfile("a");
    await deleteProfile("b");
    const cfg = await readConfig();
    expect(cfg.activeProfile).toBe("a");
  });
});

describe("setActiveProfile", () => {
  it("rejects setting a profile that does not exist", async () => {
    await expect(setActiveProfile("missing")).rejects.toThrow(/No profile named/);
  });

  it("clears activeProfile when called with undefined", async () => {
    await writeProfile("p", {businessId: "m1"});
    await setActiveProfile("p");
    await setActiveProfile(undefined);
    expect((await readConfig()).activeProfile).toBeUndefined();
  });
});

// Ensures the file-backed writeConfig round-trips without help from the
// helpers (sanity for the underlying I/O path).
describe("config round-trip with profiles", () => {
  it("writes and reads nested profiles", async () => {
    await writeConfig({
      schemaVersion: 1,
      activeProfile: "a",
      profiles: {a: {businessId: "m1", displayName: "a", defaultEnv: "sandbox", envs: {}}}
    });
    const cfg = await readConfig();
    expect(cfg.activeProfile).toBe("a");
    expect(cfg.profiles?.a.businessId).toBe("m1");
  });
});
