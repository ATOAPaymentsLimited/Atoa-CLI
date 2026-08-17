import {describe, it, expect, vi, beforeEach} from "vitest";

const mock = vi.hoisted(() => {
  const requests: Array<{method: string; path: string; auth?: string; query?: any; body?: any; pathParams?: any}> = [];
  let printed: unknown;

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
          requests.push({
            method: req.method,
            path: req.path,
            auth: req.auth,
            query: req.query,
            body: req.body,
            pathParams: req.pathParams
          });
          if (req.path === "/api/business/:businessId/users/" && req.method === "POST") {
            return {status: 200, data: {id: "u2", user: {firstName: "Bob"}, role: {name: "Admin"}}, requestId: "r"};
          }
          if (req.path === "/api/business/:businessId/users/:userId" && req.method === "DELETE") {
            return {status: 200, data: {success: true}, requestId: "r"};
          }
          return {status: 200, data: {}, requestId: "r"};
        }
      },
      format: "json",
      formatExplicit: true,
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

import staffAdd from "../../src/commands/staff/add";
import staffRemove from "../../src/commands/staff/delete";

beforeEach(() => {
  mock.reset();
  process.exitCode = 0;
});

describe("staff add", () => {
  it("POSTs with firstName/lastName/roleId/email in body", async () => {
    await (staffAdd.run as any)({
      args: {firstName: "Bob", lastName: "Jones", role: "role_admin", email: "bob@example.com"},
      rawArgs: []
    });
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].method).toBe("POST");
    expect(mock.requests[0].body).toMatchObject({
      firstName: "Bob",
      lastName: "Jones",
      roleId: "role_admin",
      email: "bob@example.com"
    });
  });

  it("collects repeated --store flags into permittedStoreIds", async () => {
    await (staffAdd.run as any)({
      args: {firstName: "Bob", lastName: "Jones", role: "role_admin", email: "bob@example.com"},
      rawArgs: ["--store", "st_1", "--store", "st_2"]
    });
    expect(mock.requests[0].body).toMatchObject({permittedStoreIds: ["st_1", "st_2"]});
  });

  it("errors (exit 3) when --first-name is missing on a non-TTY run", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (staffAdd.run as any)({args: {lastName: "Jones", role: "role_admin", email: "bob@example.com"}, rawArgs: []});
    expect(process.exitCode).toBe(3);
    expect(mock.requests).toHaveLength(0);
    stderr.mockRestore();
  });

  it("errors (exit 3) when neither email nor phone is provided", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (staffAdd.run as any)({args: {firstName: "Bob", lastName: "Jones", role: "role_admin"}, rawArgs: []});
    expect(process.exitCode).toBe(3);
    stderr.mockRestore();
  });

  it("--dryRun does not send a request", async () => {
    await (staffAdd.run as any)({
      args: {firstName: "Bob", lastName: "Jones", role: "role_admin", email: "bob@example.com", dryRun: true},
      rawArgs: []
    });
    expect(mock.requests).toHaveLength(0);
  });
});

describe("staff remove", () => {
  it("DELETEs by userId when --yes is passed (no prompt needed)", async () => {
    await (staffRemove.run as any)({args: {userId: "u1", yes: true}, rawArgs: []});
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].method).toBe("DELETE");
    expect(mock.requests[0].pathParams).toMatchObject({userId: "u1"});
  });

  it("errors (exit 3) when userId is omitted on a non-TTY run", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (staffRemove.run as any)({args: {}, rawArgs: []});
    expect(process.exitCode).toBe(3);
    stderr.mockRestore();
  });

  it("errors (exit 3) when --yes is omitted on a non-TTY run", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (staffRemove.run as any)({args: {userId: "u1"}, rawArgs: []});
    expect(process.exitCode).toBe(3);
    expect(mock.requests).toHaveLength(0);
    stderr.mockRestore();
  });

  it("--dryRun does not send a request", async () => {
    await (staffRemove.run as any)({args: {userId: "u1", yes: true, dryRun: true}, rawArgs: []});
    expect(mock.requests).toHaveLength(0);
  });
});
