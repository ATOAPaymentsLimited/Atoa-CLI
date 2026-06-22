import {describe, it, expect, vi, beforeEach} from "vitest";

/**
 * Task 7: staff list / staff invite tests.
 */

const mock = vi.hoisted(() => {
  const requests: Array<{method: string; path: string; auth?: string; query?: any; body?: any}> = [];
  let printed: unknown = undefined;

  return {
    requests,
    getPrinted: () => printed,
    reset() {
      requests.length = 0;
      printed = undefined;
    },
    buildContext: async (opts: any) => ({
      env: "sandbox",
      http: {
        baseUrl: "https://api.atoa.me",
        request: async (req: any) => {
          requests.push({method: req.method, path: req.path, auth: req.auth, query: req.query, body: req.body});
          if (req.path === "/api/business/:businessId/users/" && req.method === "GET") {
            // Pagination<BusinessToUser> — name/email nested under `user`, role under `role`.
            return {
              status: 200,
              data: {
                data: [
                  {
                    id: "u1",
                    user: {firstName: "Alice", lastName: "Smith", email: "alice@example.com"},
                    role: {name: "Admin"}
                  }
                ],
                totalCount: 1
              },
              requestId: "r"
            };
          }
          if (req.path === "/api/business/:businessId/users/" && req.method === "POST") {
            return {
              status: 200,
              data: {id: "u2", user: {firstName: "Bob"}, role: {name: "Admin"}},
              requestId: "r"
            };
          }
          return {status: 200, data: {}, requestId: "r"};
        }
      },
      format: "json",
      verbose: false,
      dryRun: opts.dryRun ?? false,
      yes: opts.yes ?? false,
      authFingerprint: "RnIs",
      profileName: "acme",
      profile: {businessId: "biz_1", displayName: "Acme", envs: {sandbox: {tokenFingerprint: "x"}}},
      print: (data: unknown) => {
        printed = data;
      }
    })
  };
});

vi.mock("../../src/lib/context", async () => {
  const actual = await vi.importActual<any>("../../src/lib/context");
  return {...actual, buildContext: mock.buildContext};
});

import staffList from "../../src/commands/staff/list";
import staffInvite from "../../src/commands/staff/invite";

beforeEach(() => {
  mock.reset();
  process.exitCode = 0;
});

describe("staff list", () => {
  it("GETs /api/business/:businessId/users/ with jwt auth", async () => {
    await (staffList.run as any)({args: {}, rawArgs: []});
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].method).toBe("GET");
    expect(mock.requests[0].path).toBe("/api/business/:businessId/users/");
    expect(mock.requests[0].auth).toBe("jwt");
  });

  it("requests page=0,size=100 via fetchAllPages and prints the rows", async () => {
    await (staffList.run as any)({args: {}, rawArgs: []});
    expect(mock.requests[0].path).toBe("/api/business/:businessId/users/");
    expect(mock.requests[0].query).toMatchObject({page: "0", size: "100"});
    const data = mock.getPrinted() as any[];
    expect(Array.isArray(data)).toBe(true);
    expect(data[0].user.firstName).toBe("Alice");
  });

  it("prints the staff list", async () => {
    await (staffList.run as any)({args: {}, rawArgs: []});
    const data = mock.getPrinted() as any[];
    expect(Array.isArray(data)).toBe(true);
    expect(data[0].user.firstName).toBe("Alice");
  });

  it("--dryRun does not send a request", async () => {
    await (staffList.run as any)({args: {dryRun: true}, rawArgs: []});
    expect(mock.requests).toHaveLength(0);
  });
});

describe("staff invite", () => {
  it("POSTs /api/business/:businessId/users/ with jwt auth", async () => {
    await (staffInvite.run as any)({
      args: {firstName: "Bob", lastName: "Jones", role: "role_admin", email: "bob@example.com"},
      rawArgs: ["--first-name", "Bob", "--last-name", "Jones", "--role", "role_admin"]
    });
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].method).toBe("POST");
    expect(mock.requests[0].path).toBe("/api/business/:businessId/users/");
    expect(mock.requests[0].auth).toBe("jwt");
  });

  it("sends firstName, lastName, roleId in body", async () => {
    await (staffInvite.run as any)({
      args: {firstName: "Bob", lastName: "Jones", role: "role_admin", email: "bob@example.com"},
      rawArgs: []
    });
    expect(mock.requests[0].body).toMatchObject({firstName: "Bob", lastName: "Jones", roleId: "role_admin"});
  });

  it("includes email and phoneNumber when provided", async () => {
    await (staffInvite.run as any)({
      args: {
        firstName: "Bob",
        lastName: "Jones",
        role: "role_admin",
        email: "bob@example.com",
        phoneCountryCode: "44",
        phone: "7700900000"
      },
      rawArgs: []
    });
    expect(mock.requests[0].body).toMatchObject({email: "bob@example.com", phoneNumber: "7700900000"});
  });

  it("collects repeated --store flags into permittedStoreIds", async () => {
    await (staffInvite.run as any)({
      args: {firstName: "Bob", lastName: "Jones", role: "role_admin", email: "bob@example.com"},
      rawArgs: ["--store", "st_1", "--store", "st_2"]
    });
    expect(mock.requests[0].body).toMatchObject({permittedStoreIds: ["st_1", "st_2"]});
  });

  it("does not include permittedStoreIds when no --store is provided", async () => {
    await (staffInvite.run as any)({
      args: {firstName: "Bob", lastName: "Jones", role: "role_admin", email: "bob@example.com"},
      rawArgs: []
    });
    expect(mock.requests[0].body).not.toHaveProperty("permittedStoreIds");
  });

  it("errors when --first-name is missing", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (staffInvite.run as any)({args: {lastName: "Jones", role: "role_admin"}, rawArgs: []});
    expect(process.exitCode).toBe(3);
    stderr.mockRestore();
  });

  it("errors when --role is missing", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (staffInvite.run as any)({args: {firstName: "Bob", lastName: "Jones"}, rawArgs: []});
    expect(process.exitCode).toBe(3);
    stderr.mockRestore();
  });

  it("--dryRun does not send a request", async () => {
    await (staffInvite.run as any)({
      args: {firstName: "Bob", lastName: "Jones", role: "role_admin", email: "bob@example.com", dryRun: true},
      rawArgs: []
    });
    expect(mock.requests).toHaveLength(0);
  });
});
