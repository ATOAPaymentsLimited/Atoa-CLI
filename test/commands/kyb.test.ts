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
    cardActivationStatusResponse: {status: "IN_REVIEW", paymentType: "ONLINE"} as Record<string, unknown>,
    formatExplicit: true,
    submitRejectMessage: "" as string,
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
              throw new AtoaError("No application", "not_found", {status: 404});
            }
            return {status: 200, data: mock.cardActivationStatusResponse, requestId: "r"};
          }
          if (req.path === "/api/business/:businessId/card-activation" && req.method === "POST") {
            if (mock.submitRejectMessage) {
              const {AtoaError} = await import("../../src/lib/errors");
              throw new AtoaError(mock.submitRejectMessage, "validation", {status: 400});
            }
            return {status: 201, data: {status: "IN_REVIEW", paymentType: req.body?.paymentType}, requestId: "r"};
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

// Mock @inquirer/prompts so `kyb card submit`'s interactive prompts never wait for real TTY input.
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
import kybCardSubmit from "../../src/commands/kyb/card/submit";
import * as prompts from "@inquirer/prompts";

// Pin the dashboard origin so the built URL is deterministic.
const DASHBOARD = "https://dashboard.atoa.me";

beforeEach(() => {
  mock.reset();
  mock.cardActivationNotFound = false;
  mock.cardActivationStatusResponse = {status: "IN_REVIEW", paymentType: "ONLINE"};
  mock.formatExplicit = true;
  mock.submitRejectMessage = "";
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

  it("--dryRun does not send a request", async () => {
    await (kybCardStatus.run as any)({args: {dryRun: true}, rawArgs: []});
    expect(mock.requests).toHaveLength(0);
    expect(mock.getPrinted()).toMatchObject({method: "GET", path: "/api/business/:businessId/card-activation"});
  });
});

describe("kyb card submit", () => {
  it("POSTs paymentType plus any provided optional fields", async () => {
    await (kybCardSubmit.run as any)({
      args: {paymentType: "online", vat: "GB123456789", maxTransactionAmount: "250"},
      rawArgs: []
    });
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].method).toBe("POST");
    expect(mock.requests[0].path).toBe("/api/business/:businessId/card-activation");
    expect(mock.requests[0].body).toEqual({
      paymentType: "ONLINE",
      vatNumber: "GB123456789",
      maxTransactionAmount: 250
    });
    expect(prompts.select).not.toHaveBeenCalled();
    expect(prompts.input).not.toHaveBeenCalled();
  });

  it("omits unset optional fields entirely rather than sending empty values", async () => {
    await (kybCardSubmit.run as any)({args: {paymentType: "IN_STORE"}, rawArgs: []});
    expect(mock.requests[0].body).toEqual({paymentType: "IN_STORE"});
  });

  it("rejects an invalid --payment-type", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (kybCardSubmit.run as any)({args: {paymentType: "CARRIER_PIGEON"}, rawArgs: []});
    expect(process.exitCode).toBe(3);
    expect(mock.requests).toHaveLength(0);
    stderr.mockRestore();
  });

  it("errors non-interactively when --payment-type is missing", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (kybCardSubmit.run as any)({args: {}, rawArgs: []});
    expect(process.exitCode).toBe(3);
    expect(mock.requests).toHaveLength(0);
    stderr.mockRestore();
  });

  it("--dryRun does not send a request", async () => {
    await (kybCardSubmit.run as any)({args: {paymentType: "BOTH", dryRun: true}, rawArgs: []});
    expect(mock.requests).toHaveLength(0);
  });

  describe("dashboard hint on dashboard-only preconditions", () => {
    const runAndCaptureStderr = async (): Promise<string> => {
      let out = "";
      const stderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk: any) => {
        out += chunk;
        return true;
      });
      await (kybCardSubmit.run as any)({args: {paymentType: "ONLINE"}, rawArgs: []});
      stderr.mockRestore();
      return out;
    };

    it("appends the kyb card link hint when statements are missing", async () => {
      mock.submitRejectMessage = "Both a bank statement and a card statement are required to submit";
      const out = await runAndCaptureStderr();
      expect(out).toContain("Both a bank statement and a card statement are required to submit");
      expect(out).toContain("atoa kyb card link");
      expect(process.exitCode).toBe(3);
    });

    it("appends the hint when KYB is not submitted", async () => {
      mock.submitRejectMessage = "KYB is not submitted";
      const out = await runAndCaptureStderr();
      expect(out).toContain("atoa kyb card link");
    });

    // The field-validation 400s are fixable with CLI flags — sending the user to the
    // dashboard for those would be wrong, so the hint must NOT fire.
    it("does NOT append the hint for field-validation failures", async () => {
      mock.submitRejectMessage = "Maximum transaction amount is required";
      const out = await runAndCaptureStderr();
      expect(out).toContain("Maximum transaction amount is required");
      expect(out).not.toContain("atoa kyb card link");
    });
  });

  describe("interactive (TTY, no --output)", () => {
    const origTTY = process.stdout.isTTY;

    beforeEach(() => {
      mock.formatExplicit = false;
      (process.stdout as any).isTTY = true;
    });

    afterEach(() => {
      (process.stdout as any).isTTY = origTTY;
    });

    it("prompts for every field left unset", async () => {
      vi.mocked(prompts.select).mockResolvedValueOnce("BOTH");
      vi.mocked(prompts.input)
        .mockResolvedValueOnce("https://example.com") // website
        .mockResolvedValueOnce("") // vat (skipped)
        .mockResolvedValueOnce("5") // avgFulfilmentDays
        .mockResolvedValueOnce("100"); // maxTransactionAmount

      await (kybCardSubmit.run as any)({args: {}, rawArgs: []});

      expect(prompts.select).toHaveBeenCalledTimes(1);
      expect(prompts.input).toHaveBeenCalledTimes(4);
      expect(mock.requests[0].body).toEqual({
        paymentType: "BOTH",
        webSiteUrl: "https://example.com",
        avgPurchaseFulfilmentDays: 5,
        maxTransactionAmount: 100
      });
    });

    it("does not prompt for fields already supplied as flags", async () => {
      vi.mocked(prompts.input).mockResolvedValue(""); // vat, avgFulfilmentDays, maxTransactionAmount — all skipped
      await (kybCardSubmit.run as any)({args: {paymentType: "ONLINE", website: "https://example.com"}, rawArgs: []});
      expect(prompts.select).not.toHaveBeenCalled();
      // Only vat, avgFulfilmentDays, maxTransactionAmount are still unset — website was given as a flag.
      expect(prompts.input).toHaveBeenCalledTimes(3);
      expect(mock.requests[0].body).toEqual({paymentType: "ONLINE", webSiteUrl: "https://example.com"});
    });
  });
});

describe("kyb card index wiring", () => {
  it("every subCommand thunk resolves to a defined module", async () => {
    const mod = await import("../../src/commands/kyb/card");
    const entries = Object.entries(mod.default.subCommands ?? {});
    expect(entries.map(([name]) => name)).toEqual(["status", "submit", "link"]);
    for (const [name, thunk] of entries) {
      expect(await (thunk as () => Promise<unknown>)(), `${name} should resolve`).toBeDefined();
    }
  });
});
