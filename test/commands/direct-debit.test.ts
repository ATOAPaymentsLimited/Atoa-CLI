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
    mandateActive: false,
    buildContext: async (opts: any) => ({
      env: "sandbox",
      http: {
        baseUrl: "https://api.atoa.me",
        request: async (req: any) => {
          requests.push({method: req.method, path: req.path, auth: req.auth, body: req.body});
          if (req.path === "/api/plan/:businessId/assignedPlan" && req.method === "GET") {
            // Shaped like the real response: there is NO `isDirectDebitSetup` field — whether a
            // mandate exists is derived from the mandate's own status. An earlier mock invented
            // that field, so code reading it passed the tests and always read undefined live.
            return {
              status: 200,
              data: {stripeCustomer: {mandateDetails: mock.mandateActive ? {status: "active"} : undefined}},
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
  mock.mandateActive = false;
  process.exitCode = 0;
});

// No country/state — those are fixed to GB/UK on the wire rather than collected.
const FULL_ARGS = {
  sortCode: "123456",
  accountNumber: "12345678",
  name: "Acme Ltd",
  email: "billing@acme.example",
  addressLine1: "1 Test Rd",
  city: "London",
  postalCode: "SW11AA"
};

describe("direct-debit status", () => {
  it("GETs assignedPlan and prints mandate state", async () => {
    mock.mandateActive = true;
    await (directDebitStatus.run as any)({args: {}, rawArgs: []});
    expect(mock.requests[0]).toMatchObject({method: "GET", path: "/api/plan/:businessId/assignedPlan"});
    expect(mock.getPrinted()).toMatchObject({isDirectDebitSetup: true, mandateStatus: "active"});
  });
});

describe("direct-debit setup", () => {
  it("errors (exit 3) when a required field is missing on a non-TTY run", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const {city: _city, ...incomplete} = FULL_ARGS;
    await (directDebitSetup.run as any)({args: incomplete, rawArgs: []});
    expect(process.exitCode).toBe(3);
    stderr.mockRestore();
  });

  it.each([
    ["accountNumber", "1234567"],
    ["sortCode", "12345"],
    ["email", "not-an-email"],
    ["name", "a name that is very much longer than twenty"]
  ])("errors (exit 3) on an invalid %s", async (field, value) => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (directDebitSetup.run as any)({args: {...FULL_ARGS, [field]: value}, rawArgs: []});
    expect(process.exitCode).toBe(3);
    expect(mock.requests.some((r) => r.method === "POST")).toBe(false);
    stderr.mockRestore();
  });

  it("submits the BACS setup intent with the given details when no mandate is active", async () => {
    await (directDebitSetup.run as any)({args: FULL_ARGS, rawArgs: []});
    const postReq = mock.requests.find((r) => r.method === "POST");
    expect(postReq).toBeDefined();
    expect(postReq!.body.payment_method_data.bacs_debit).toMatchObject({
      type: "bacs_debit",
      sort_code: "123456",
      account_number: "12345678"
    });
    expect(postReq!.body.updateBacs).toBe(false);
  });

  it("fixes the GB/UK address pair and strips postcode spaces", async () => {
    await (directDebitSetup.run as any)({args: {...FULL_ARGS, postalCode: "SW1 1AA"}, rawArgs: []});
    const postReq = mock.requests.find((r) => r.method === "POST");
    expect(postReq!.body.payment_method_data.billing_details.address).toMatchObject({
      country: "GB",
      state: "UK",
      postal_code: "SW11AA"
    });
  });

  // Derived from the mandate status, not a field on the response — reading a non-existent
  // `isDirectDebitSetup` made this guard silently dead against the real API.
  it("refuses outright when a mandate is already active", async () => {
    mock.mandateActive = true;
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
