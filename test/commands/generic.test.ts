import {describe, it, expect, vi, beforeEach} from "vitest";

const mock = vi.hoisted(() => {
  const requests: Array<{method: string; path: string; query?: any; body?: any; auth?: string}> = [];
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
          requests.push({
            method: req.method,
            path,
            query: req.query,
            body: req.body,
            auth: req.auth
          });
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

import get from "../../src/commands/get";
import post from "../../src/commands/post";
import del from "../../src/commands/delete";

beforeEach(() => mock.reset());

describe("get", () => {
  it("GETs the literal path when no field args", async () => {
    await (get.run as any)({args: {path: "/api/customers"}, rawArgs: []});
    expect(mock.requests[0]).toMatchObject({method: "GET", path: "/api/customers"});
  });

  it("substitutes :param placeholders from -d field args", async () => {
    await (get.run as any)({
      args: {path: "/api/customers/:id"},
      rawArgs: ["-d", "id=cus_1"]
    });
    expect(mock.requests[0].path).toBe("/api/customers/cus_1");
  });

  it("puts leftover field args into query string", async () => {
    await (get.run as any)({
      args: {path: "/api/customers"},
      rawArgs: ["-d", "limit=5", "-d", "search=jane"]
    });
    expect(mock.requests[0].query).toMatchObject({limit: "5", search: "jane"});
  });

  // Regression: these commands run under runWithContext (a JWT context whose authHeader is
  // literally "unused"), so omitting `auth` let http.ts fall back to its "sdk" default and
  // every request 401'd. Assert the mode explicitly — the shape assertions above passed
  // throughout because the mock ignored auth entirely.
  it("sends jwt auth, not the sdk default", async () => {
    await (get.run as any)({args: {path: "/api/customers"}, rawArgs: []});
    expect(mock.requests[0].auth).toBe("jwt");
  });

  it("sends jwt auth on the --page-all path too", async () => {
    await (get.run as any)({args: {path: "/api/customers", pageAll: true}, rawArgs: []});
    expect(mock.requests.length).toBeGreaterThan(0);
    for (const req of mock.requests) expect(req.auth).toBe("jwt");
  });
});

describe("post", () => {
  it("builds a body from -d field args", async () => {
    await (post.run as any)({
      args: {path: "/api/customers"},
      rawArgs: ["-d", "fullName=Jane", "-d", "email=j@x.com"]
    });
    expect(mock.requests[0]).toMatchObject({
      method: "POST",
      path: "/api/customers",
      body: {fullName: "Jane", email: "j@x.com"}
    });
  });

  it("sends jwt auth, not the sdk default", async () => {
    await (post.run as any)({args: {path: "/api/customers"}, rawArgs: []});
    expect(mock.requests[0].auth).toBe("jwt");
  });
});

describe("delete", () => {
  it("DELETEs the literal path when --yes is set", async () => {
    await (del.run as any)({args: {path: "/api/customers/cus_1", yes: true}, rawArgs: []});
    expect(mock.requests[0]).toMatchObject({method: "DELETE", path: "/api/customers/cus_1"});
  });

  it("sends jwt auth, not the sdk default", async () => {
    await (del.run as any)({args: {path: "/api/customers/cus_1", yes: true}, rawArgs: []});
    expect(mock.requests[0].auth).toBe("jwt");
  });
});
