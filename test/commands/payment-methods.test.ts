import {describe, it, expect, vi, beforeEach} from "vitest";

const mock = vi.hoisted(() => {
  const requests: Array<{method: string; path: string}> = [];
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
          requests.push({method: req.method, path});
          return {status: 200, data: {id: "card_1"}, requestId: "r"};
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

import list from "../../src/commands/payment-methods/list";
import get from "../../src/commands/payment-methods/get";
import del from "../../src/commands/payment-methods/delete";

beforeEach(() => mock.reset());

describe("payment-methods list", () => {
  it("GETs /api/customers/:customerId/cards", async () => {
    await (list.run as any)({args: {customer: "cus_1"}, rawArgs: []});
    expect(mock.requests[0]).toEqual({method: "GET", path: "/api/customers/cus_1/cards"});
  });
});

describe("payment-methods get", () => {
  it("GETs the single card path", async () => {
    await (get.run as any)({args: {id: "card_1", customer: "cus_1"}, rawArgs: []});
    expect(mock.requests[0]).toEqual({method: "GET", path: "/api/customers/cus_1/cards/card_1"});
  });

  it("URL-encodes ids", async () => {
    await (get.run as any)({args: {id: "card 1/x", customer: "cus 1"}, rawArgs: []});
    expect(mock.requests[0].path).toBe("/api/customers/cus%201/cards/card%201%2Fx");
  });
});

describe("payment-methods delete", () => {
  it("DELETEs when --yes", async () => {
    await (del.run as any)({args: {id: "card_1", customer: "cus_1", yes: true}, rawArgs: []});
    expect(mock.requests[0]).toEqual({method: "DELETE", path: "/api/customers/cus_1/cards/card_1"});
  });
});
