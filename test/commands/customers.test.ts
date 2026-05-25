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
          return {status: 200, data: {id: "cus_1"}, requestId: "r"};
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

import create from "../../src/commands/customers/create";
import list from "../../src/commands/customers/list";
import get from "../../src/commands/customers/get";
import update from "../../src/commands/customers/update";
import del from "../../src/commands/customers/delete";

beforeEach(() => mock.reset());

describe("customers create", () => {
  it("POSTs /api/customers with required fields", async () => {
    await (create.run as any)({args: {fullName: "Jane", email: "j@x.com"}, rawArgs: []});
    expect(mock.requests[0]).toMatchObject({
      method: "POST",
      path: "/api/customers",
      body: {fullName: "Jane", email: "j@x.com"}
    });
  });

  it("includes optional fields when supplied", async () => {
    await (create.run as any)({
      args: {
        fullName: "X",
        email: "x@x.com",
        type: "BUSINESS",
        vatNumber: "GB123",
        phoneNumber: "7700",
        phoneCountryCode: "44"
      },
      rawArgs: []
    });
    expect(mock.requests[0].body).toMatchObject({
      type: "BUSINESS",
      vatNumber: "GB123",
      phoneNumber: "7700",
      phoneCountryCode: "44"
    });
  });
});

describe("customers list", () => {
  it("GETs /api/customers with default page/size", async () => {
    await (list.run as any)({args: {page: "0", size: "20"}, rawArgs: []});
    expect(mock.requests[0]).toMatchObject({method: "GET", path: "/api/customers", query: {page: "0", size: "20"}});
  });

  it("includes search filter when supplied", async () => {
    await (list.run as any)({args: {page: "0", size: "20", search: "jane"}, rawArgs: []});
    expect(mock.requests[0].query).toMatchObject({search: "jane"});
  });
});

describe("customers get", () => {
  it("GETs /api/customers/:id with URL-encoded id", async () => {
    await (get.run as any)({args: {id: "cus 1"}, rawArgs: []});
    expect(mock.requests[0]).toMatchObject({method: "GET", path: "/api/customers/cus%201"});
  });
});

describe("customers update", () => {
  it("PUTs only the provided fields", async () => {
    await (update.run as any)({args: {id: "cus_1", fullName: "New", vatNumber: "GB999"}, rawArgs: []});
    expect(mock.requests[0]).toMatchObject({
      method: "PUT",
      path: "/api/customers/cus_1",
      body: {fullName: "New", vatNumber: "GB999"}
    });
    expect(mock.requests[0].body.email).toBeUndefined();
  });
});

describe("customers delete", () => {
  it("DELETEs /api/customers/:id when --yes", async () => {
    await (del.run as any)({args: {id: "cus_1", yes: true}, rawArgs: []});
    expect(mock.requests[0]).toMatchObject({method: "DELETE", path: "/api/customers/cus_1"});
  });
});
