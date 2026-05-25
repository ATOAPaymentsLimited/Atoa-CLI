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
          if (req.pathParams)
            for (const [k, v] of Object.entries(req.pathParams))
              path = path.replace(`:${k}`, encodeURIComponent(String(v)));
          requests.push({method: req.method, path, query: req.query, body: req.body});
          return {status: 200, data: {ok: true}, requestId: "r"};
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

import initiate from "../../src/commands/bank-feed/initiate";
import accounts from "../../src/commands/bank-feed/accounts";
import account from "../../src/commands/bank-feed/account";
import balance from "../../src/commands/bank-feed/balance";
import transactions from "../../src/commands/bank-feed/transactions";
import revoke from "../../src/commands/bank-feed/revoke";

beforeEach(() => mock.reset());

describe("bank-feed initiate", () => {
  it("POSTs /api/bank/auth/initiate with redirectUrl", async () => {
    await (initiate.run as any)({args: {redirectUrl: "https://cb.com"}, rawArgs: []});
    expect(mock.requests[0]).toMatchObject({
      method: "POST",
      path: "/api/bank/auth/initiate",
      body: {redirectUrl: "https://cb.com"}
    });
  });

  it("includes callbackParams when supplied", async () => {
    await (initiate.run as any)({args: {redirectUrl: "https://cb.com", callbackParams: "ref=abc"}, rawArgs: []});
    expect(mock.requests[0].body).toMatchObject({callbackParams: "ref=abc"});
  });
});

describe("bank-feed accounts", () => {
  it("GETs /api/bank/:accountAuthId/accounts", async () => {
    await (accounts.run as any)({args: {accountAuthId: "aa_1"}, rawArgs: []});
    expect(mock.requests[0]).toMatchObject({method: "GET", path: "/api/bank/aa_1/accounts"});
  });

  it("URL-encodes the accountAuthId", async () => {
    await (accounts.run as any)({args: {accountAuthId: "aa/1"}, rawArgs: []});
    expect(mock.requests[0].path).toBe("/api/bank/aa%2F1/accounts");
  });
});

describe("bank-feed account", () => {
  it("GETs /api/bank/accounts/:id", async () => {
    await (account.run as any)({args: {id: "acc_1"}, rawArgs: []});
    expect(mock.requests[0]).toMatchObject({method: "GET", path: "/api/bank/accounts/acc_1"});
  });
});

describe("bank-feed balance", () => {
  it("GETs /api/bank/accounts/:id/balance", async () => {
    await (balance.run as any)({args: {id: "acc_1"}, rawArgs: []});
    expect(mock.requests[0]).toMatchObject({method: "GET", path: "/api/bank/accounts/acc_1/balance"});
  });
});

describe("bank-feed transactions", () => {
  it("GETs transactions with from/before query", async () => {
    await (transactions.run as any)({
      args: {id: "acc_1", from: "2026-01-01", before: "2026-02-01"},
      rawArgs: []
    });
    expect(mock.requests[0]).toMatchObject({
      method: "GET",
      path: "/api/bank/accounts/acc_1/transactions",
      query: {from: "2026-01-01", before: "2026-02-01"}
    });
  });
});

describe("bank-feed revoke", () => {
  it("POSTs /api/bank/auth/revoke with accountAuthId in body", async () => {
    await (revoke.run as any)({args: {accountAuthId: "aa_1", yes: true}, rawArgs: []});
    expect(mock.requests[0]).toMatchObject({
      method: "POST",
      path: "/api/bank/auth/revoke",
      body: {accountAuthId: "aa_1"}
    });
  });

  it("sends no body when accountAuthId is absent", async () => {
    await (revoke.run as any)({args: {yes: true}, rawArgs: []});
    expect(mock.requests[0]).toMatchObject({method: "POST", path: "/api/bank/auth/revoke"});
    expect(mock.requests[0].body).toBeUndefined();
  });
});
