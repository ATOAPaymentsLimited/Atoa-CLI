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
          requests.push({method: req.method, path: req.path});
          return {status: 200, data: [], requestId: "r"};
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

import list from "../../src/commands/institutions/list";

beforeEach(() => mock.reset());

describe("institutions list", () => {
  it("GETs /api/institutions", async () => {
    await (list.run as any)({args: {}, rawArgs: []});
    expect(mock.requests[0]).toEqual({method: "GET", path: "/api/institutions"});
  });
});
