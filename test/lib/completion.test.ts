import {describe, it, expect, vi, beforeEach} from "vitest";
import {defineCommand} from "citty";

const state = vi.hoisted(() => ({
  profiles: {} as Record<string, {businessId: string; envs: Record<string, {sdkAccessId?: string}>}>
}));

vi.mock("../../src/lib/config-store", () => ({
  readConfig: vi.fn(async () => ({
    schemaVersion: 1 as const,
    profiles: state.profiles
  }))
}));

import {suggest} from "../../src/lib/completion";

// Tiny stand-in for atoa's real command tree — just enough to exercise the
// walker. Mirrors the real shape (lazy thunks under subCommands).
const fakeRoot = defineCommand({
  meta: {name: "atoa"},
  subCommands: {
    login: () =>
      Promise.resolve(
        defineCommand({
          meta: {name: "login"},
          args: {
            env: {type: "string"},
            interactive: {type: "boolean"},
            profile: {type: "string"}
          }
        })
      ),
    keys: () =>
      Promise.resolve(
        defineCommand({
          meta: {name: "keys"},
          subCommands: {
            revoke: () =>
              Promise.resolve(
                defineCommand({
                  meta: {name: "revoke"},
                  args: {
                    id: {type: "positional", required: false},
                    env: {type: "string"}
                  }
                })
              ),
            regenerate: () =>
              Promise.resolve(
                defineCommand({
                  meta: {name: "regenerate"},
                  args: {
                    id: {type: "positional", required: false}
                  }
                })
              )
          }
        })
      ),
    profile: () =>
      Promise.resolve(
        defineCommand({
          meta: {name: "profile"},
          subCommands: {
            use: () =>
              Promise.resolve(
                defineCommand({
                  meta: {name: "use"},
                  args: {name: {type: "positional", required: true}}
                })
              )
          }
        })
      )
  }
});

beforeEach(() => {
  state.profiles = {
    vignesh: {businessId: "mid_1", envs: {sandbox: {sdkAccessId: "sda-vignesh-sand"}}},
    "acme-coffee": {businessId: "mid_2", envs: {production: {sdkAccessId: "sda-acme-prod"}}}
  };
});

describe("suggest()", () => {
  it('completes top-level subcommand names after "atoa "', async () => {
    const out = await suggest(fakeRoot, "atoa ");
    expect(out).toEqual(expect.arrayContaining(["login", "keys", "profile"]));
  });

  it("filters top-level by prefix", async () => {
    const out = await suggest(fakeRoot, "atoa k");
    expect(out).toEqual(["keys"]);
  });

  it("descends into nested subcommands", async () => {
    const out = await suggest(fakeRoot, "atoa keys ");
    expect(out.sort()).toEqual(["regenerate", "revoke"]);
  });

  it("completes --flag names when tail starts with --", async () => {
    const out = await suggest(fakeRoot, "atoa login --in");
    expect(out).toContain("--interactive");
    expect(out.every((f) => f.startsWith("--in"))).toBe(true);
  });

  it("always offers the common flags (env, profile, output, etc.)", async () => {
    const out = await suggest(fakeRoot, "atoa keys revoke --");
    expect(out).toEqual(expect.arrayContaining(["--env", "--profile", "--output"]));
  });

  it("completes --env values from the static enum", async () => {
    const out = await suggest(fakeRoot, "atoa login --env ");
    expect(out.sort()).toEqual(["production", "sandbox"]);
  });

  it("filters --env values by prefix", async () => {
    const out = await suggest(fakeRoot, "atoa login --env sa");
    expect(out).toEqual(["sandbox"]);
  });

  it("completes profile names dynamically for `profile use <TAB>`", async () => {
    const out = await suggest(fakeRoot, "atoa profile use ");
    expect(out.sort()).toEqual(["acme-coffee", "vignesh"]);
  });

  it("filters dynamic profile names by prefix", async () => {
    const out = await suggest(fakeRoot, "atoa profile use a");
    expect(out).toEqual(["acme-coffee"]);
  });

  it("completes --profile values dynamically (wildcard resolver)", async () => {
    const out = await suggest(fakeRoot, "atoa keys revoke --profile ");
    expect(out.sort()).toEqual(["acme-coffee", "vignesh"]);
  });

  it("completes sdkAccessIds for `keys revoke <TAB>` from active profile envs", async () => {
    const out = await suggest(fakeRoot, "atoa keys revoke ");
    expect(out.sort()).toEqual(["sda-acme-prod", "sda-vignesh-sand"]);
  });

  it("returns nothing when config has no profiles", async () => {
    state.profiles = {};
    expect(await suggest(fakeRoot, "atoa profile use ")).toEqual([]);
    expect(await suggest(fakeRoot, "atoa keys revoke ")).toEqual([]);
  });
});
