import {describe, it, expect, vi, beforeEach} from "vitest";

const mock = vi.hoisted(() => {
  const requests: Array<{method: string; path: string; query?: any; body?: any}> = [];
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
          if (req.pathParams) {
            for (const [k, v] of Object.entries(req.pathParams)) {
              path = path.replace(`:${k}`, encodeURIComponent(String(v)));
            }
          }
          requests.push({
            method: req.method,
            path,
            query: req.query,
            body: req.body
          });
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

import create from "../../src/commands/payments/create";
import status from "../../src/commands/payments/status";
import cancel from "../../src/commands/payments/cancel";
import transactions from "../../src/commands/payments/transactions";
import stores from "../../src/commands/stores/list";

beforeEach(() => mock.reset());

describe("payments create", () => {
  it("POSTs to /api/payments/process-payment with required fields", async () => {
    await (create.run as any)({
      args: {amount: "10.50", orderId: "O1", redirectUrl: "https://r.com"},
      rawArgs: []
    });
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].method).toBe("POST");
    expect(mock.requests[0].path).toBe("/api/payments/process-payment");
    expect(mock.requests[0].body).toMatchObject({amount: 10.5, orderId: "O1", redirectUrl: "https://r.com"});
  });

  it("passes optional fields through", async () => {
    await (create.run as any)({
      args: {
        amount: "5.00",
        orderId: "O2",
        redirectUrl: "https://r.com",
        storeId: "st_1",
        notes: "tip",
        enableTips: true
      },
      rawArgs: []
    });
    expect(mock.requests[0].body).toMatchObject({storeId: "st_1", notes: "tip", enableTips: true});
  });
});

describe("payments status", () => {
  it("GETs /api/payments/v1/payment-status/:id with URL-encoded id", async () => {
    await (status.run as any)({args: {id: "pr 1/x"}, rawArgs: []});
    expect(mock.requests[0].method).toBe("GET");
    expect(mock.requests[0].path).toBe("/api/payments/v1/payment-status/pr%201%2Fx");
  });

  it("passes env query param matching ctx.env", async () => {
    await (status.run as any)({args: {id: "pr_1", env: "production"}, rawArgs: []});
    expect(mock.requests[0].query).toEqual({env: "production"});

    mock.reset();
    await (status.run as any)({args: {id: "pr_1", env: "sandbox"}, rawArgs: []});
    expect(mock.requests[0].query).toEqual({env: "sandbox"});
  });
});

describe("payments cancel", () => {
  it("hits the cancel route", async () => {
    await (cancel.run as any)({args: {id: "pr_1", yes: true}, rawArgs: []});
    expect(mock.requests[0].method).toMatch(/POST|DELETE/);
    expect(mock.requests[0].path).toContain("pr_1");
  });
});

describe("payments transactions", () => {
  it("POSTs /api/payments/transactions with filters in the body", async () => {
    await (transactions.run as any)({
      args: {page: "0", size: "20", from: "2026-01-01", status: "COMPLETED,FAILED", storeIds: "a,b"},
      rawArgs: []
    });
    expect(mock.requests[0].method).toBe("POST");
    expect(mock.requests[0].path).toBe("/api/payments/transactions");
    expect(mock.requests[0].query).toMatchObject({page: "0", size: "20"});
    expect(mock.requests[0].body).toMatchObject({
      fromDate: "2026-01-01",
      status: ["COMPLETED", "FAILED"],
      storeIds: ["a", "b"]
    });
  });
});

describe("stores list", () => {
  it("GETs /api/payments/stores", async () => {
    await (stores.run as any)({args: {}, rawArgs: []});
    expect(mock.requests[0]).toMatchObject({method: "GET", path: "/api/payments/stores"});
  });
});
