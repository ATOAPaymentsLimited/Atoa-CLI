import {describe, it, expect, vi, beforeEach, afterEach} from "vitest";

/**
 * Task 7: kyb status / kyb link (with --open) tests.
 */

const mock = vi.hoisted(() => {
  const requests: Array<{method: string; path: string; auth?: string; body?: any}> = [];
  let printed: unknown = undefined;

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
          if (req.path === "/api/merchant/:businessId/getKybStatus") {
            return {status: 200, data: {status: "PENDING", manualReviewRequired: false}, requestId: "r"};
          }
          return {status: 200, data: {}, requestId: "r"};
        }
      },
      format: "json",
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

const browserMock = vi.hoisted(() => ({
  openBrowser: vi.fn(async (_url: string) => true)
}));
vi.mock("../../src/lib/browser", () => ({openBrowser: browserMock.openBrowser}));

// `kyb link` reads the active business id from the stored config (not the
// context profile) to build the dashboard deep-link CLI-side — stub it.
const configMock = vi.hoisted(() => ({
  getActiveBusinessId: vi.fn(async (_profile: string) => "biz_1")
}));
vi.mock("../../src/lib/config-store", async () => {
  const actual = await vi.importActual<any>("../../src/lib/config-store");
  return {...actual, getActiveBusinessId: configMock.getActiveBusinessId};
});

import kybStatus from "../../src/commands/kyb/status";
import kybLink from "../../src/commands/kyb/link";

// Pin the dashboard origin so the built URL is deterministic.
const DASHBOARD = "https://dashboard.atoa.me";

beforeEach(() => {
  mock.reset();
  browserMock.openBrowser.mockClear();
  configMock.getActiveBusinessId.mockClear();
  configMock.getActiveBusinessId.mockResolvedValue("biz_1");
  process.env.ATOA_DASHBOARD_URL = DASHBOARD;
  process.exitCode = 0;
});

afterEach(() => {
  delete process.env.ATOA_DASHBOARD_URL;
});

describe("kyb status", () => {
  it("GETs /api/merchant/:businessId/getKybStatus with jwt auth", async () => {
    await (kybStatus.run as any)({args: {}, rawArgs: []});
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].method).toBe("GET");
    expect(mock.requests[0].path).toBe("/api/merchant/:businessId/getKybStatus");
    expect(mock.requests[0].auth).toBe("jwt");
  });

  it("prints the status response", async () => {
    await (kybStatus.run as any)({args: {}, rawArgs: []});
    const data = mock.getPrinted() as any;
    expect(data).toMatchObject({status: "PENDING"});
  });

  it("--dryRun does not send a request", async () => {
    await (kybStatus.run as any)({args: {dryRun: true}, rawArgs: []});
    expect(mock.requests).toHaveLength(0);
    expect(mock.getPrinted()).toMatchObject({method: "GET", path: "/api/merchant/:businessId/getKybStatus"});
  });
});

describe("kyb link", () => {
  // The KYB deep-link is built CLI-side now (no backend endpoint): dashboard
  // origin + /kyb?businessId=<active business id>.
  const EXPECTED_URL = `${DASHBOARD}/kyb?businessId=biz_1`;

  it("builds the dashboard URL CLI-side without any HTTP request", async () => {
    await (kybLink.run as any)({args: {}, rawArgs: []});
    expect(mock.requests).toHaveLength(0);
    const data = mock.getPrinted() as any;
    expect(data.url).toBe(EXPECTED_URL);
  });

  it("prints the url", async () => {
    await (kybLink.run as any)({args: {}, rawArgs: []});
    const data = mock.getPrinted() as any;
    expect(data.url).toBe(EXPECTED_URL);
  });

  it("--open calls openBrowser with the built URL", async () => {
    await (kybLink.run as any)({args: {open: true}, rawArgs: ["--open"]});
    expect(browserMock.openBrowser).toHaveBeenCalledWith(EXPECTED_URL);
  });

  it("does not call openBrowser when --open is absent", async () => {
    await (kybLink.run as any)({args: {}, rawArgs: []});
    expect(browserMock.openBrowser).not.toHaveBeenCalled();
  });

  it("--dryRun does not send a request and does not open the browser", async () => {
    await (kybLink.run as any)({args: {dryRun: true}, rawArgs: []});
    expect(mock.requests).toHaveLength(0);
    expect(browserMock.openBrowser).not.toHaveBeenCalled();
    const data = mock.getPrinted() as any;
    expect(data.url).toBe(EXPECTED_URL);
  });
});
