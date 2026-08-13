import {describe, it, expect, vi, beforeEach} from "vitest";

/**
 * Plan data (current/available/upgrade/downgrade/cancelDowngrade/estimatedCharges) and feature
 * usage are served by different upstreams behind the gateway, but both accept the same merchant JWT.
 */
const PLANS = {
  basic: {id: "plan_basic", name: "Basic", monthlyAmount: 0, planOrder: 0, subscribablePlan: true, features: []},
  growth: {
    id: "plan_growth",
    name: "Growth",
    monthlyAmount: 19,
    planOrder: 1,
    subscribablePlan: true,
    features: [{type: "MULTI_STORE", limit: 2, overlimitCharges: 0}]
  },
  advanced: {
    id: "plan_advanced",
    name: "Advanced",
    monthlyAmount: 59,
    planOrder: 2,
    subscribablePlan: true,
    features: [
      {type: "MULTI_STORE", limit: null, overlimitCharges: 0},
      {type: "CUSTOM_ROLES", limit: null, overlimitCharges: 0}
    ]
  }
};

const asPlan = (p: any) => ({
  id: p.id,
  name: p.name,
  monthlyAmount: p.monthlyAmount,
  planOrder: p.planOrder,
  subscribablePlan: p.subscribablePlan,
  addonFeatureToAddonPlans: p.features.map((f: any) => ({
    limit: f.limit,
    addonFeature: {addonFeatureType: f.type, limit: f.limit, overlimitCharges: f.overlimitCharges}
  }))
});

const mock = vi.hoisted(() => {
  const requests: Array<{method: string; path: string; auth?: string; pathParams?: any}> = [];
  let printed: unknown;

  return {
    requests,
    getPrinted: () => printed,
    // Default: on Advanced, using 2 stores + 1 custom role.
    usage: [
      {featureType: "MULTI_STORE", usage: 2},
      {featureType: "CUSTOM_ROLES", usage: 1}
    ] as Array<{featureType: string; usage: number}>,
    currentPlanKey: "advanced" as "basic" | "growth" | "advanced",
    downgradeStatus: 200,
    formatExplicit: true,
    reset() {
      requests.length = 0;
      printed = undefined;
    },
    buildContext: async (opts: any) => ({
      env: "sandbox",
      http: {
        baseUrl: "https://api.atoa.me",
        request: async (req: any) => {
          requests.push({method: req.method, path: req.path, auth: req.auth, pathParams: req.pathParams});
          const {PLANS: P, asPlan: toPlan} = (globalThis as any).__addonFixtures;

          if (req.path === "/api/merchant/addonPlan/:businessId/featureUsage") {
            return {status: 200, data: mock.usage, requestId: "r"};
          }
          if (req.path === "/api/addonPlan/merchant/:businessId/current") {
            return {
              status: 200,
              data: {addonPlan: toPlan(P[mock.currentPlanKey]), renewalType: "MONTHLY"},
              requestId: "r"
            };
          }
          if (req.path === "/api/addonPlan/merchant/:businessId/available") {
            return {
              status: 200,
              data: {availablePlans: [P.basic, P.growth, P.advanced].map(toPlan)},
              requestId: "r"
            };
          }
          if (req.path === "/api/addonPlan/merchant/:businessId/estimatedMonthlyCharges") {
            return {status: 200, data: {estimatedCharges: 73.16, downgradeDate: "2026-09-12"}, requestId: "r"};
          }
          if (req.path === "/api/addonPlan/merchant/:businessId/downgrade/:addonPlanId") {
            if (mock.downgradeStatus === 428) {
              const {AtoaError} = await import("../../src/lib/errors");
              throw new AtoaError("Downgrade conditions not met", "generic", {status: 428});
            }
            return {status: 200, data: {scheduled: true}, requestId: "r"};
          }
          return {status: 200, data: {}, requestId: "r"};
        }
      },
      format: "json",
      formatExplicit: mock.formatExplicit,
      verbose: false,
      dryRun: opts.dryRun ?? false,
      yes: opts.yes ?? false,
      authFingerprint: "RnIs",
      profileName: "acme",
      profile: {businessId: "biz_1", displayName: "Acme", envs: {sandbox: {tokenFingerprint: "x"}}},
      print: (data: unknown) => {
        printed = data;
      }
    })
  };
});

(globalThis as any).__addonFixtures = {PLANS, asPlan};

vi.mock("../../src/lib/context", async () => {
  const actual = await vi.importActual<any>("../../src/lib/context");
  return {...actual, buildContext: mock.buildContext};
});

vi.mock("@inquirer/prompts", () => ({
  select: vi.fn(async ({choices}: any) => choices[0]?.value),
  confirm: vi.fn(async () => true)
}));

import addonsList from "../../src/commands/addons/list";
import addonsUpgrade from "../../src/commands/addons/upgrade";
import addonsDowngrade from "../../src/commands/addons/downgrade";
import addonsCancelDowngrade from "../../src/commands/addons/cancel-downgrade";
import addonsIndex from "../../src/commands/addons";
import {downgradeBlockers} from "../../src/commands/addons/_shared";

const paths = () => mock.requests.map((r) => r.path);

beforeEach(() => {
  mock.reset();
  mock.usage = [
    {featureType: "MULTI_STORE", usage: 2},
    {featureType: "CUSTOM_ROLES", usage: 1}
  ];
  mock.currentPlanKey = "advanced";
  mock.downgradeStatus = 200;
  mock.formatExplicit = true;
  process.exitCode = 0;
});

describe("addons list", () => {
  it("reads current plan, available plans and feature usage", async () => {
    await (addonsList.run as any)({args: {}, rawArgs: []});
    expect(paths()).toEqual(
      expect.arrayContaining([
        "/api/addonPlan/merchant/:businessId/current",
        "/api/addonPlan/merchant/:businessId/available",
        "/api/merchant/addonPlan/:businessId/featureUsage"
      ])
    );
    const out = mock.getPrinted() as any;
    expect(out.currentPlan).toMatchObject({name: "Advanced", monthlyAmount: 59});
    expect(out.featureUsage[0]).toMatchObject({featureType: "MULTI_STORE", usage: 2});
  });

  it("splits plans by direction relative to the current plan order", async () => {
    await (addonsList.run as any)({args: {}, rawArgs: []});
    const out = mock.getPrinted() as any;
    // On Advanced (order 2) → nothing to upgrade to, Growth + Basic below.
    expect(out.upgradeTo).toEqual([]);
    expect(out.downgradeTo.map((p: any) => p.name)).toEqual(["Growth", "Basic"]);
  });

  it("--dryRun sends no requests", async () => {
    await (addonsList.run as any)({args: {dryRun: true}, rawArgs: []});
    expect(mock.requests).toHaveLength(0);
  });
});

describe("addons upgrade", () => {
  beforeEach(() => {
    mock.currentPlanKey = "basic"; // so Growth/Advanced are upgrade targets
  });

  it("POSTs the chosen plan id after confirmation", async () => {
    await (addonsUpgrade.run as any)({args: {planId: "plan_advanced", yes: true}, rawArgs: []});
    const post = mock.requests.find((r) => r.method === "POST");
    expect(post).toMatchObject({
      path: "/api/addonPlan/merchant/:businessId/upgrade/:addonPlanId",
      pathParams: {addonPlanId: "plan_advanced"}
    });
  });

  it("rejects a plan id that isn't an upgrade target", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (addonsUpgrade.run as any)({args: {planId: "plan_basic", yes: true}, rawArgs: []});
    expect(process.exitCode).toBe(3);
    expect(mock.requests.some((r) => r.method === "POST")).toBe(false);
    stderr.mockRestore();
  });

  it("requires --yes when non-interactive", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (addonsUpgrade.run as any)({args: {planId: "plan_advanced"}, rawArgs: []});
    expect(process.exitCode).toBe(3);
    expect(mock.requests.some((r) => r.method === "POST")).toBe(false);
    stderr.mockRestore();
  });

  it("--dryRun does not POST", async () => {
    await (addonsUpgrade.run as any)({args: {planId: "plan_advanced", dryRun: true}, rawArgs: []});
    expect(mock.requests.some((r) => r.method === "POST")).toBe(false);
  });
});

describe("addons downgrade", () => {
  it("blocks locally when usage exceeds the target plan, without POSTing", async () => {
    // 3 stores vs Growth's limit of 2.
    mock.usage = [{featureType: "MULTI_STORE", usage: 3}];
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (addonsDowngrade.run as any)({args: {planId: "plan_growth", yes: true}, rawArgs: []});
    expect(process.exitCode).toBe(3);
    expect(mock.requests.some((r) => r.method === "POST")).toBe(false);
    stderr.mockRestore();
  });

  it("blocks when a feature in use is absent from the target plan", async () => {
    // Basic has no CUSTOM_ROLES at all.
    mock.usage = [{featureType: "CUSTOM_ROLES", usage: 1}];
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (addonsDowngrade.run as any)({args: {planId: "plan_basic", yes: true}, rawArgs: []});
    expect(process.exitCode).toBe(3);
    expect(mock.requests.some((r) => r.method === "POST")).toBe(false);
    stderr.mockRestore();
  });

  it("POSTs when usage fits the target plan", async () => {
    mock.usage = [{featureType: "MULTI_STORE", usage: 1}];
    await (addonsDowngrade.run as any)({args: {planId: "plan_growth", yes: true}, rawArgs: []});
    const post = mock.requests.find((r) => r.method === "POST");
    expect(post).toMatchObject({pathParams: {addonPlanId: "plan_growth"}});
  });

  it("--dryRun reports the blockers without POSTing", async () => {
    mock.usage = [{featureType: "MULTI_STORE", usage: 3}];
    await (addonsDowngrade.run as any)({args: {planId: "plan_growth", dryRun: true}, rawArgs: []});
    expect(mock.requests.some((r) => r.method === "POST")).toBe(false);
    const out = mock.getPrinted() as any;
    expect(out.blockers[0]).toContain("MULTI_STORE");
  });
});

describe("downgradeBlockers (mirrors the backend's downgrade eligibility rule)", () => {
  const growth = asPlan(PLANS.growth);
  const basic = asPlan(PLANS.basic);

  it("allows exactly one bank account even when the plan lacks the feature", () => {
    expect(downgradeBlockers([{featureType: "MULTI_BANK_ACCOUNT", usage: 1}], basic)).toEqual([]);
  });

  it("blocks two bank accounts on a plan without the feature", () => {
    expect(downgradeBlockers([{featureType: "MULTI_BANK_ACCOUNT", usage: 2}], basic)).toHaveLength(1);
  });

  it("ignores zero usage of a feature the target plan lacks", () => {
    expect(downgradeBlockers([{featureType: "CUSTOM_ROLES", usage: 0}], basic)).toEqual([]);
  });

  it("allows usage up to the target limit but not beyond", () => {
    expect(downgradeBlockers([{featureType: "MULTI_STORE", usage: 2}], growth)).toEqual([]);
    expect(downgradeBlockers([{featureType: "MULTI_STORE", usage: 3}], growth)).toHaveLength(1);
  });

  it("treats a null limit as unlimited", () => {
    expect(downgradeBlockers([{featureType: "MULTI_STORE", usage: 99}], asPlan(PLANS.advanced))).toEqual([]);
  });
});

describe("addons cancel-downgrade", () => {
  it("DELETEs the cancelDowngrade route with --yes", async () => {
    await (addonsCancelDowngrade.run as any)({args: {yes: true}, rawArgs: []});
    expect(mock.requests[0]).toMatchObject({
      method: "DELETE",
      path: "/api/addonPlan/merchant/:businessId/cancelDowngrade"
    });
  });

  it("requires --yes when non-interactive", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (addonsCancelDowngrade.run as any)({args: {}, rawArgs: []});
    expect(process.exitCode).toBe(3);
    expect(mock.requests).toHaveLength(0);
    stderr.mockRestore();
  });
});

describe("addons group", () => {
  it("exposes list + the three plan-management verbs", () => {
    expect(Object.keys(addonsIndex.subCommands ?? {})).toEqual(["list", "upgrade", "downgrade", "cancel-downgrade"]);
  });
});
