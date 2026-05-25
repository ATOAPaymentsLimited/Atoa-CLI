import {describe, it, expect, vi, beforeEach} from "vitest";

const mock = vi.hoisted(() => {
  const requests: Array<{method: string; path: string; query?: any}> = [];
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
          requests.push({method: req.method, path, query: req.query});
          return {status: 200, data: {data: [], totalCount: 0}, requestId: "r"};
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

import list from "../../src/commands/payouts/list";
import transactions from "../../src/commands/payouts/transactions";

beforeEach(() => mock.reset());

describe("payouts list", () => {
  it("GETs /api/payouts with default page/limit", async () => {
    await (list.run as any)({args: {page: "0", limit: "20"}, rawArgs: []});
    expect(mock.requests[0]).toMatchObject({
      method: "GET",
      path: "/api/payouts",
      query: {page: "0", limit: "20"}
    });
  });

  it("includes optional filters when supplied", async () => {
    await (list.run as any)({
      args: {page: "0", limit: "50", status: "COMPLETED", fromDate: "2026-01-01", search: "q"},
      rawArgs: []
    });
    expect(mock.requests[0].query).toMatchObject({
      page: "0",
      limit: "50",
      status: "COMPLETED",
      fromDate: "2026-01-01",
      search: "q"
    });
  });
});

describe("payouts transactions", () => {
  it("GETs /api/payouts/:id/transactions with page/limit", async () => {
    await (transactions.run as any)({args: {id: "po_1", page: "0", limit: "20"}, rawArgs: []});
    expect(mock.requests[0]).toMatchObject({
      method: "GET",
      path: "/api/payouts/po_1/transactions",
      query: {page: "0", limit: "20"}
    });
  });

  it("URL-encodes payoutId", async () => {
    await (transactions.run as any)({args: {id: "po/1", page: "0", limit: "20"}, rawArgs: []});
    expect(mock.requests[0].path).toBe("/api/payouts/po%2F1/transactions");
  });
});
