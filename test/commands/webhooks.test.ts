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
          return {status: 200, data: {id: "wh_1"}, requestId: "r"};
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
  return {...actual, buildSdkContext: mock.buildContext};
});

import create from "../../src/commands/webhooks/create";
import list from "../../src/commands/webhooks/list";
import del from "../../src/commands/webhooks/delete";

beforeEach(() => mock.reset());

describe("webhooks create", () => {
  it("POSTs /api/webhook/merchant with url and event", async () => {
    await (create.run as any)({args: {url: "https://h.com/x", event: "PAYMENTS_STATUS"}, rawArgs: []});
    expect(mock.requests[0]).toMatchObject({
      method: "POST",
      path: "/api/webhook/merchant",
      body: {url: "https://h.com/x", event: "PAYMENTS_STATUS"}
    });
  });

  it("passes through arbitrary event strings (backend validates)", async () => {
    await (create.run as any)({args: {url: "https://h.com/x", event: "SOME_NEW_EVENT"}, rawArgs: []});
    expect(mock.requests[0].body.event).toBe("SOME_NEW_EVENT");
  });
});

describe("webhooks list", () => {
  it("GETs /api/webhook/merchant", async () => {
    await (list.run as any)({args: {}, rawArgs: []});
    expect(mock.requests[0]).toMatchObject({method: "GET", path: "/api/webhook/merchant"});
  });
});

describe("webhooks delete", () => {
  it("DELETEs the webhook merchant route", async () => {
    await (del.run as any)({args: {id: "wh_1", yes: true}, rawArgs: []});
    expect(mock.requests[0]).toMatchObject({method: "DELETE", path: "/api/webhook/wh_1/merchant"});
  });
});
