import {describe, it, expect} from "vitest";
import {planAction} from "../../src/lib/keys-plan";
import type {EnvState, ProfileConfig} from "../../src/lib/config-store";

function profile(envs: ProfileConfig["envs"]): ProfileConfig {
  return {
    businessId: "biz_1",
    displayName: "Test Co",
    envs
  };
}

// `null` means "explicitly omit the identifier" so we can test the missing-id
// guard; `undefined`/no-arg gets the default identifier.
const defaultState = (sdkAccessId: string | null = "sda-123"): EnvState => ({
  tokenFingerprint: "bbbb",
  ...(sdkAccessId ? {sdkAccessId} : {})
});

describe("planAction (happy path)", () => {
  it("plans both envs when no --env is passed", () => {
    const p = profile({sandbox: defaultState("sda-s"), production: defaultState("sda-p")});
    const plan = planAction(p, "revoke");
    expect(plan.kind).toBe("execute");
    if (plan.kind === "execute") {
      expect(plan.targets.map((t) => t.env).sort()).toEqual(["production", "sandbox"]);
    }
  });

  it("scopes to one env when --env is passed", () => {
    const p = profile({sandbox: defaultState("sda-s"), production: defaultState("sda-p")});
    const plan = planAction(p, "revoke", "production");
    expect(plan.kind).toBe("execute");
    if (plan.kind === "execute") {
      expect(plan.targets).toHaveLength(1);
      expect(plan.targets[0].env).toBe("production");
    }
  });

  it("refuses a target with no sdkAccessId", () => {
    const p = profile({sandbox: defaultState(null)});
    const plan = planAction(p, "revoke");
    expect(plan).toMatchObject({
      kind: "error",
      message: expect.stringMatching(/sandbox credentials have no sdkAccessId/)
    });
  });
});

describe("planAction (validation errors)", () => {
  it("errors when the profile has no configured envs", () => {
    expect(planAction(profile({}), "revoke")).toEqual({
      kind: "error",
      message: "no credentials configured for this profile"
    });
  });

  it("errors when --env targets an env the profile does not have", () => {
    const p = profile({sandbox: defaultState()});
    expect(planAction(p, "revoke", "production")).toEqual({
      kind: "error",
      message: "no production credentials for this profile"
    });
  });
});
