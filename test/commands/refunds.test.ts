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
          return {status: 200, data: {id: "rf_1"}, requestId: "r"};
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

import create from "../../src/commands/refunds/create";
import cancel from "../../src/commands/refunds/cancel";
import list from "../../src/commands/refunds/list";

beforeEach(() => mock.reset());

describe("refunds create", () => {
  it("POSTs /api/refund with paymentRequestId and amount", async () => {
    await (create.run as any)({args: {paymentRequestId: "pr_1", amount: "10", yes: true}, rawArgs: []});
    expect(mock.requests[0]).toMatchObject({
      method: "POST",
      path: "/api/refund",
      body: {paymentRequestId: "pr_1", amount: 10}
    });
  });

  it("includes currency and refundNotes when supplied", async () => {
    await (create.run as any)({
      args: {paymentRequestId: "pr_1", amount: "500", currency: "GBP", notes: "dup charge", yes: true},
      rawArgs: []
    });
    expect(mock.requests[0].body).toMatchObject({
      paymentRequestId: "pr_1",
      amount: 500,
      currency: "GBP",
      refundNotes: "dup charge"
    });
  });

  it("accepts --reason as an alias for --notes", async () => {
    await (create.run as any)({
      args: {paymentRequestId: "pr_1", amount: "5", reason: "customer asked", yes: true},
      rawArgs: []
    });
    expect(mock.requests[0].body.refundNotes).toBe("customer asked");
  });

  it("rejects amount below 1 (server minimum) without sending a request", async () => {
    process.exitCode = 0;
    await (create.run as any)({args: {paymentRequestId: "pr_1", amount: "0", yes: true}, rawArgs: []});
    expect(process.exitCode).not.toBe(0);
    expect(mock.requests).toHaveLength(0);
    process.exitCode = 0;
  });
});

describe("refunds cancel", () => {
  it("DELETEs the cancel route", async () => {
    await (cancel.run as any)({args: {id: "rf_1", yes: true}, rawArgs: []});
    expect(mock.requests[0]).toMatchObject({method: "DELETE", path: "/api/refund/rf_1/cancel"});
  });
});

describe("refunds list", () => {
  it("GETs /api/refund/:paymentRequestId", async () => {
    await (list.run as any)({args: {paymentRequestId: "pr_1"}, rawArgs: []});
    expect(mock.requests[0]).toMatchObject({method: "GET", path: "/api/refund/pr_1"});
  });
});
