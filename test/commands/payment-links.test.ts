import {describe, it, expect, vi, beforeEach} from "vitest";

/**
 * Task 7: payment-links create tests.
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
          // PaymentLinks response: {id, amount, status, paymentLink, ...}.
          return {
            status: 200,
            data: {
              id: "pl_abc123",
              amount: req.body?.amount,
              status: "ACTIVE",
              paymentLink: "https://pay.atoa.me/link/abc123"
            },
            requestId: "r"
          };
        }
      },
      format: "json",
      verbose: false,
      dryRun: opts.dryRun ?? false,
      yes: false,
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

import createPaymentLink from "../../src/commands/payment-links/create";

beforeEach(() => {
  mock.reset();
  process.exitCode = 0;
});

describe("payment-links create", () => {
  it("POSTs /api/business/:businessId/links/payment/store/:storeId with jwt auth", async () => {
    await (createPaymentLink.run as any)({args: {amount: "100", storeId: "store_1"}, rawArgs: []});
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].method).toBe("POST");
    expect(mock.requests[0].path).toBe("/api/business/:businessId/links/payment/store/:storeId");
    expect(mock.requests[0].auth).toBe("jwt");
  });

  it("sends amount (GBP, decimal) and LINK source in body", async () => {
    await (createPaymentLink.run as any)({args: {amount: "2.50", storeId: "store_1"}, rawArgs: []});
    expect(mock.requests[0].body).toMatchObject({amount: 2.5, paymentDetails: {source: "LINK"}});
  });

  it("includes notes when provided", async () => {
    await (createPaymentLink.run as any)({
      args: {amount: "5", storeId: "store_1", notes: "Test payment"},
      rawArgs: []
    });
    expect(mock.requests[0].body).toMatchObject({
      amount: 5,
      paymentDetails: {source: "LINK"},
      notes: "Test payment"
    });
  });

  it("validates: --store-id is required", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (createPaymentLink.run as any)({args: {amount: "100"}, rawArgs: []});
    expect(process.exitCode).toBe(3);
    const errOut = stderr.mock.calls.map((c) => String(c[0])).join("");
    expect(errOut).toMatch(/store-id/i);
    stderr.mockRestore();
  });

  it("prints the paymentLink from the response", async () => {
    await (createPaymentLink.run as any)({args: {amount: "100", storeId: "store_1"}, rawArgs: []});
    const data = mock.getPrinted() as any;
    expect(data.paymentLink).toBe("https://pay.atoa.me/link/abc123");
  });

  it("validates: amount 0 fails with exit code 3", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (createPaymentLink.run as any)({args: {amount: "0", storeId: "store_1"}, rawArgs: []});
    expect(process.exitCode).toBe(3);
    const errOut = stderr.mock.calls.map((c) => String(c[0])).join("");
    expect(errOut).toMatch(/amount/i);
    stderr.mockRestore();
  });

  it("validates: negative amount fails with exit code 3", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (createPaymentLink.run as any)({args: {amount: "-5", storeId: "store_1"}, rawArgs: []});
    expect(process.exitCode).toBe(3);
    stderr.mockRestore();
  });

  it("validates: non-numeric amount fails with exit code 3", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (createPaymentLink.run as any)({args: {amount: "abc", storeId: "store_1"}, rawArgs: []});
    expect(process.exitCode).toBe(3);
    stderr.mockRestore();
  });

  it("--dryRun does not send a request", async () => {
    await (createPaymentLink.run as any)({
      args: {amount: "100", storeId: "store_1", dryRun: true},
      rawArgs: []
    });
    expect(mock.requests).toHaveLength(0);
  });
});
