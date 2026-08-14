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
    cardActivationNotFound: false,
    notFoundMessage: "No card application found for this business",
    cardActivationStatusResponse: {status: "IN_REVIEW", paymentType: "ONLINE"} as Record<string, unknown>,
    formatExplicit: true,
    buildContext: async (opts: any) => ({
      env: "sandbox",
      http: {
        baseUrl: "https://api.atoa.me",
        request: async (req: any) => {
          requests.push({method: req.method, path: req.path, auth: req.auth, body: req.body});
          if (req.path === "/api/merchant/:businessId/getKybStatus") {
            return {status: 200, data: {status: "APPROVED"}, requestId: "r"};
          }
          if (req.path === "/api/business/:businessId/card-activation" && req.method === "GET") {
            if (mock.cardActivationNotFound) {
              const {AtoaError} = await import("../../src/lib/errors");
              // Verbatim from the backend, so the discriminator is tested against reality.
              throw new AtoaError(mock.notFoundMessage, "not_found", {status: 404});
            }
            return {status: 200, data: mock.cardActivationStatusResponse, requestId: "r"};
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

vi.mock("../../src/lib/context", async () => {
  const actual = await vi.importActual<any>("../../src/lib/context");
  return {...actual, buildContext: mock.buildContext};
});

const browserMock = vi.hoisted(() => ({
  openBrowser: vi.fn(async (_url: string) => true)
}));
vi.mock("../../src/lib/browser", () => ({openBrowser: browserMock.openBrowser}));

// Mock @inquirer/prompts so interactive prompts never wait for real TTY input.
vi.mock("@inquirer/prompts", () => ({
  select: vi.fn(async ({choices}: any) => choices[0]?.value),
  input: vi.fn(async () => "")
}));

// `kyb link` reads the active business id from the stored config (not the
// context profile) to build the dashboard deep-link CLI-side — stub it.
const configMock = vi.hoisted(() => ({
  getActiveBusinessId: vi.fn(async (_profile: string): Promise<string | undefined> => "biz_1")
}));
vi.mock("../../src/lib/config-store", async () => {
  const actual = await vi.importActual<any>("../../src/lib/config-store");
  return {...actual, getActiveBusinessId: configMock.getActiveBusinessId};
});

import kybStatus from "../../src/commands/kyb/status";
import kybLink from "../../src/commands/kyb/link";
import kybCardLink from "../../src/commands/kyb/card/link";
import kybCardStatus from "../../src/commands/kyb/card/status";
import * as prompts from "@inquirer/prompts";

// Pin the dashboard origin so the built URL is deterministic.
const DASHBOARD = "https://dashboard.atoa.me";

beforeEach(() => {
  mock.reset();
  mock.cardActivationNotFound = false;
  mock.notFoundMessage = "No card application found for this business";
  mock.cardActivationStatusResponse = {status: "IN_REVIEW", paymentType: "ONLINE"};
  mock.formatExplicit = true;
  browserMock.openBrowser.mockClear();
  configMock.getActiveBusinessId.mockClear();
  configMock.getActiveBusinessId.mockResolvedValue("biz_1");
  vi.mocked(prompts.select).mockClear();
  vi.mocked(prompts.input).mockClear();
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

  it("prints only the status when APPROVED", async () => {
    await (kybStatus.run as any)({args: {}, rawArgs: []});
    const data = mock.getPrinted() as any;
    // Approved → headline status only (no rejectRemarks / declinedCodes noise).
    expect(data).toEqual({status: "APPROVED"});
  });

  it("--dryRun does not send a request", async () => {
    await (kybStatus.run as any)({args: {dryRun: true}, rawArgs: []});
    expect(mock.requests).toHaveLength(0);
    expect(mock.getPrinted()).toMatchObject({method: "GET", path: "/api/merchant/:businessId/getKybStatus"});
  });
});

describe("kyb link", () => {
  // The KYB deep-link is built CLI-side now (no backend endpoint): dashboard
  // origin + /verification?merchantId=<active business id> (the dashboard's
  // verification page reads the business id from the merchantId query param).
  const EXPECTED_URL = `${DASHBOARD}/verification?merchantId=biz_1`;

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

  it("calls openBrowser by default when --open is absent", async () => {
    await (kybLink.run as any)({args: {}, rawArgs: []});
    expect(browserMock.openBrowser).toHaveBeenCalledWith(EXPECTED_URL);
  });

  it("--open=true calls openBrowser with the built URL", async () => {
    await (kybLink.run as any)({args: {open: true}, rawArgs: ["--open"]});
    expect(browserMock.openBrowser).toHaveBeenCalledWith(EXPECTED_URL);
  });

  it("--no-open does not call openBrowser", async () => {
    await (kybLink.run as any)({args: {open: false}, rawArgs: ["--no-open"]});
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

describe("kyb card link", () => {
  // Same shape as `kyb link`, but points at /card-signup — the entry point for
  // an already-KYB'd merchant applying for card afterwards (not /verification,
  // which already covers card opt-in for a merchant still going through KYB).
  const EXPECTED_URL = `${DASHBOARD}/card-signup?merchantId=biz_1`;

  it("builds the card-signup dashboard URL CLI-side without any HTTP request", async () => {
    await (kybCardLink.run as any)({args: {}, rawArgs: []});
    expect(mock.requests).toHaveLength(0);
    const data = mock.getPrinted() as any;
    expect(data.url).toBe(EXPECTED_URL);
  });

  it("calls openBrowser by default when --open is absent", async () => {
    await (kybCardLink.run as any)({args: {}, rawArgs: []});
    expect(browserMock.openBrowser).toHaveBeenCalledWith(EXPECTED_URL);
  });

  it("--open=true calls openBrowser with the built URL", async () => {
    await (kybCardLink.run as any)({args: {open: true}, rawArgs: ["--open"]});
    expect(browserMock.openBrowser).toHaveBeenCalledWith(EXPECTED_URL);
  });

  it("--no-open does not call openBrowser", async () => {
    await (kybCardLink.run as any)({args: {open: false}, rawArgs: ["--no-open"]});
    expect(browserMock.openBrowser).not.toHaveBeenCalled();
  });

  it("errors when there is no active business", async () => {
    configMock.getActiveBusinessId.mockResolvedValueOnce(undefined);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (kybCardLink.run as any)({args: {}, rawArgs: []});
    expect(process.exitCode).toBe(3);
    stderr.mockRestore();
  });
});

describe("kyb card status", () => {
  it("GETs /api/business/:businessId/card-activation with jwt auth", async () => {
    await (kybCardStatus.run as any)({args: {}, rawArgs: []});
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].method).toBe("GET");
    expect(mock.requests[0].path).toBe("/api/business/:businessId/card-activation");
    expect(mock.requests[0].auth).toBe("jwt");
  });

  it("prints the application status", async () => {
    await (kybCardStatus.run as any)({args: {}, rawArgs: []});
    const data = mock.getPrinted() as any;
    expect(data).toEqual({status: "IN_REVIEW", paymentType: "ONLINE"});
  });

  // NOT_INITIATED, not NOT_APPLIED — same spelling the dashboard's CardApplicationStatus
  // enum uses for this client-side-only state, so the two surfaces agree.
  it("treats a 404 (never applied) as a NOT_INITIATED status instead of an error", async () => {
    mock.cardActivationNotFound = true;
    await (kybCardStatus.run as any)({args: {}, rawArgs: []});
    expect(process.exitCode).toBe(0);
    const data = mock.getPrinted() as any;
    expect(data.status).toBe("NOT_INITIATED");
  });

  // Regression: this used to match ANY 404, so a stale businessId, a routing mistake or a
  // gateway 404 all reported "you haven't applied yet" — which would tell a merchant with a
  // pending or rejected application to re-apply.
  it("does NOT mask an unrelated 404 as NOT_INITIATED", async () => {
    mock.cardActivationNotFound = true;
    mock.notFoundMessage = "Cannot GET /api/business/xyz/card-activation";
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (kybCardStatus.run as any)({args: {}, rawArgs: []});
    stderr.mockRestore();

    expect(process.exitCode).toBe(4); // not_found, surfaced rather than swallowed
    expect(mock.getPrinted()).toBeUndefined();
  });

  it("--dryRun does not send a request", async () => {
    await (kybCardStatus.run as any)({args: {dryRun: true}, rawArgs: []});
    expect(mock.requests).toHaveLength(0);
    expect(mock.getPrinted()).toMatchObject({method: "GET", path: "/api/business/:businessId/card-activation"});
  });
});

describe("kyb card index wiring", () => {
  it("every subCommand thunk resolves to a defined module", async () => {
    const mod = await import("../../src/commands/kyb/card");
    const entries = Object.entries(mod.default.subCommands ?? {});
    expect(entries.map(([name]) => name)).toEqual(["status", "link"]);
    for (const [name, thunk] of entries) {
      expect(await (thunk as () => Promise<unknown>)(), `${name} should resolve`).toBeDefined();
    }
  });
});
