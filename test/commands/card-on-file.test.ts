import {describe, it, expect, vi, beforeEach} from "vitest";

const mock = vi.hoisted(() => {
  const requests: Array<{method: string; path: string; body?: any}> = [];
  return {
    requests,
    reset() {
      requests.length = 0;
    },
    buildContext: async (opts: any) => ({
      env: opts.env === "production" ? "production" : "sandbox",
      http: {
        baseUrl: "https://api.atoa.me",
        request: async (req: any) => {
          let path: string = req.path;
          if (req.pathParams)
            for (const [k, v] of Object.entries(req.pathParams))
              path = path.replace(`:${k}`, encodeURIComponent(String(v)));
          requests.push({method: req.method, path, body: req.body});
          return {status: 200, data: {id: "pr_1"}, requestId: "r"};
        }
      },
      format: "json",
      verbose: false,
      dryRun: opts.dryRun ?? false,
      yes: opts.yes ?? true,
      logger: {flush: () => {}},
      requestId: "r",
      authFingerprint: "abcd",
      print: () => {}
    })
  };
});

vi.mock("../../src/lib/context", async () => {
  const actual = await vi.importActual<any>("../../src/lib/context");
  return {...actual, buildContext: mock.buildContext};
});

import charge from "../../src/commands/card-on-file/charge";
import capture from "../../src/commands/card-on-file/capture";
import cancel from "../../src/commands/card-on-file/cancel";

beforeEach(() => mock.reset());

describe("card-on-file charge", () => {
  it("POSTs to /api/payments/card/process-payment with AUTO_CAPTURE default", async () => {
    await (charge.run as any)({
      args: {customerId: "cus_1", paymentMethodId: "card_1", amount: "10.50", orderId: "O1"},
      rawArgs: []
    });
    expect(mock.requests[0]).toMatchObject({
      method: "POST",
      path: "/api/payments/card/process-payment",
      body: {customerId: "cus_1", paymentMethodId: "card_1", amount: 10.5, orderId: "O1", captureType: "AUTO_CAPTURE"}
    });
  });

  it("honors explicit captureType", async () => {
    await (charge.run as any)({
      args: {
        customerId: "cus_1",
        paymentMethodId: "card_1",
        amount: "25.00",
        orderId: "O2",
        captureType: "MANUAL_CAPTURE"
      },
      rawArgs: []
    });
    expect(mock.requests[0].body.captureType).toBe("MANUAL_CAPTURE");
  });
});

describe("card-on-file capture", () => {
  it("POSTs the capture path", async () => {
    await (capture.run as any)({args: {id: "pr_1", yes: true}, rawArgs: []});
    expect(mock.requests[0]).toMatchObject({
      method: "POST",
      path: "/api/payments/card/payment-request/pr_1/capture"
    });
  });

  it("sends no body (server does not accept a partial-capture body)", async () => {
    await (capture.run as any)({args: {id: "pr_1", yes: true}, rawArgs: []});
    expect(mock.requests[0].body).toBeUndefined();
  });
});

describe("card-on-file cancel", () => {
  it("POSTs the cancel path with reason fields", async () => {
    await (cancel.run as any)({
      args: {id: "pr_1", reasonCode: "Requested by customer", reasonDescription: "no longer needed", yes: true},
      rawArgs: []
    });
    expect(mock.requests[0]).toMatchObject({
      method: "POST",
      path: "/api/payments/card/payment-request/pr_1/cancel",
      body: {cancelledReasonCode: "Requested by customer", cancelledReasonDescription: "no longer needed"}
    });
  });

  it("sends no body when no reason supplied", async () => {
    await (cancel.run as any)({args: {id: "pr_1", yes: true}, rawArgs: []});
    expect(mock.requests[0].body).toBeUndefined();
  });
});
