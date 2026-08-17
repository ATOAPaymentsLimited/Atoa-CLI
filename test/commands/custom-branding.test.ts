import {describe, it, expect, vi, beforeEach} from "vitest";

const mock = vi.hoisted(() => {
  const requests: Array<{method: string; path: string; auth?: string; body?: any}> = [];
  let printed: unknown;

  return {
    requests,
    getPrinted: () => printed,
    reset() {
      requests.length = 0;
      printed = undefined;
    },
    buildContext: async (opts: any) => ({
      env: "sandbox",
      http: {
        baseUrl: "https://api.atoa.me",
        request: async (req: any) => {
          requests.push({method: req.method, path: req.path, auth: req.auth, body: req.body});
          if (req.path === "/api/business/:businessId/options" && req.method === "GET") {
            return {status: 200, data: {theme: {colorCode: "#112233"}}, requestId: "r"};
          }
          if (req.path === "/api/business/:businessId/options" && req.method === "PUT") {
            return {status: 200, data: req.body, requestId: "r"};
          }
          return {status: 200, data: {}, requestId: "r"};
        }
      },
      format: "json",
      formatExplicit: true,
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

vi.mock("../../src/lib/context", async () => {
  const actual = await vi.importActual<any>("../../src/lib/context");
  return {...actual, buildContext: mock.buildContext};
});

import brandingGet from "../../src/commands/custom-branding/get";
import brandingSet from "../../src/commands/custom-branding/set";
import brandingReset from "../../src/commands/custom-branding/reset";

beforeEach(() => {
  mock.reset();
  process.exitCode = 0;
});

describe("branding get", () => {
  it("GETs options and prints the theme colour", async () => {
    await (brandingGet.run as any)({args: {}, rawArgs: []});
    expect(mock.requests[0]).toMatchObject({method: "GET", path: "/api/business/:businessId/options"});
    expect(mock.getPrinted()).toMatchObject({colorCode: "#112233"});
  });
});

describe("branding set", () => {
  it("PUTs {theme: {colorCode}}", async () => {
    await (brandingSet.run as any)({args: {colorCode: "#ABCDEF"}, rawArgs: []});
    expect(mock.requests[0]).toMatchObject({method: "PUT", body: {theme: {colorCode: "#ABCDEF"}}});
  });

  it("errors (exit 3) on an invalid hex colour", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (brandingSet.run as any)({args: {colorCode: "red"}, rawArgs: []});
    expect(process.exitCode).toBe(3);
    expect(mock.requests).toHaveLength(0);
    stderr.mockRestore();
  });

  it("--dryRun does not send a request", async () => {
    await (brandingSet.run as any)({args: {colorCode: "#ABCDEF", dryRun: true}, rawArgs: []});
    expect(mock.requests).toHaveLength(0);
  });
});

describe("branding reset", () => {
  it('PUTs {theme: {colorCode: ""}}', async () => {
    await (brandingReset.run as any)({args: {}, rawArgs: []});
    expect(mock.requests[0]).toMatchObject({method: "PUT", body: {theme: {colorCode: ""}}});
  });
});
