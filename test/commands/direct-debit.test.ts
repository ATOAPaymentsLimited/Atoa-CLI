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
    isDirectDebitSetup: false,
    buildContext: async (opts: any) => ({
      env: "sandbox",
      http: {
        baseUrl: "https://api.atoa.me",
        request: async (req: any) => {
          requests.push({method: req.method, path: req.path, auth: req.auth, body: req.body});
          if (req.path === "/api/plan/:businessId/assignedPlan" && req.method === "GET") {
            return {
              status: 200,
              data: {
                isDirectDebitSetup: mock.isDirectDebitSetup,
                stripeCustomer: {mandateDetails: {status: mock.isDirectDebitSetup ? "active" : undefined}}
              },
              requestId: "r"
            };
          }
          if (req.path === "/api/stripe/:businessId/confirm-setup-intent" && req.method === "POST") {
            return {status: 200, data: {}, requestId: "r"};
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

import directDebitStatus from "../../src/commands/direct-debit/status";
import directDebitSetup from "../../src/commands/direct-debit/setup";

beforeEach(() => {
  mock.reset();
  mock.isDirectDebitSetup = false;
  process.exitCode = 0;
});

const FULL_ARGS = {
  sortCode: "123456",
  accountNumber: "12345678",
  name: "Acme Ltd",
  email: "billing@acme.example",
  addressLine1: "1 Test Rd",
  city: "London",
  postalCode: "SW1 1AA",
  country: "GB"
};

describe("direct-debit status", () => {
  it("GETs assignedPlan and prints mandate state", async () => {
    mock.isDirectDebitSetup = true;
    await (directDebitStatus.run as any)({args: {}, rawArgs: []});
    expect(mock.requests[0]).toMatchObject({method: "GET", path: "/api/plan/:businessId/assignedPlan"});
    expect(mock.getPrinted()).toMatchObject({isDirectDebitSetup: true, mandateStatus: "active"});
  });
});

describe("direct-debit setup", () => {
  it("errors (exit 3) when a required field is missing on a non-TTY run", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const {country: _country, ...incomplete} = FULL_ARGS;
    await (directDebitSetup.run as any)({args: incomplete, rawArgs: []});
    expect(process.exitCode).toBe(3);
    stderr.mockRestore();
  });

  it("submits the BACS setup intent with the given details when no mandate is active", async () => {
    await (directDebitSetup.run as any)({args: FULL_ARGS, rawArgs: []});
    const postReq = mock.requests.find((r) => r.method === "POST");
    expect(postReq).toBeDefined();
    expect(postReq!.body.payment_method_data.bacs_debit).toMatchObject({
      sort_code: "123456",
      account_number: "12345678"
    });
    expect(postReq!.body.updateBacs).toBe(false);
  });

  it("errors (exit 3) on a non-TTY run when a mandate is already active (needs interactive confirm)", async () => {
    mock.isDirectDebitSetup = true;
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (directDebitSetup.run as any)({args: FULL_ARGS, rawArgs: []});
    expect(process.exitCode).toBe(3);
    expect(mock.requests.some((r) => r.method === "POST")).toBe(false);
    stderr.mockRestore();
  });

  it("--dryRun does not send the confirm-setup-intent request", async () => {
    await (directDebitSetup.run as any)({args: {...FULL_ARGS, dryRun: true}, rawArgs: []});
    expect(mock.requests.some((r) => r.method === "POST")).toBe(false);
  });
});
