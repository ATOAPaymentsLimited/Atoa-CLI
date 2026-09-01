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

// These are SDK-key commands: they authenticate with a minted key, not the browser session,
// so the SDK context is what has to be stubbed.
vi.mock("../../src/lib/context", async () => {
  const actual = await vi.importActual<any>("../../src/lib/context");
  return {...actual, buildSdkContext: mock.buildContext};
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

  // These raw-request commands run under the SDK-key context, so they leave `auth` unset and
  // let the client apply its SDK default. Asserted explicitly: the shape assertions above pass
  // either way, so nothing else here would notice the mode changing.
  it("leaves auth unset so the SDK default applies", async () => {
    await (get.run as any)({args: {path: "/api/customers"}, rawArgs: []});
    expect(mock.requests[0].auth).toBeUndefined();
  });

  it("leaves auth unset on the --page-all path too", async () => {
    await (get.run as any)({args: {path: "/api/customers", pageAll: true}, rawArgs: []});
    expect(mock.requests.length).toBeGreaterThan(0);
    for (const req of mock.requests) expect(req.auth).toBeUndefined();
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

  it("leaves auth unset so the SDK default applies", async () => {
    await (post.run as any)({args: {path: "/api/customers"}, rawArgs: []});
    expect(mock.requests[0].auth).toBeUndefined();
  });
});

describe("delete", () => {
  it("DELETEs the literal path when --yes is set", async () => {
    await (del.run as any)({args: {path: "/api/customers/cus_1", yes: true}, rawArgs: []});
    expect(mock.requests[0]).toMatchObject({method: "DELETE", path: "/api/customers/cus_1"});
  });

  it("leaves auth unset so the SDK default applies", async () => {
    await (del.run as any)({args: {path: "/api/customers/cus_1", yes: true}, rawArgs: []});
    expect(mock.requests[0].auth).toBeUndefined();
  });
});
