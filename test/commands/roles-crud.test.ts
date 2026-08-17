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
          if (req.path === "/api/business/:businessId/users/role/" && req.method === "GET") {
            return {
              status: 200,
              data: {
                data: [{id: "role_1", name: "Cashier", description: "desc", permissions: [{id: "perm_1"}]}],
                totalCount: 1
              },
              requestId: "r"
            };
          }
          if (req.path === "/api/business/:businessId/users/role/" && req.method === "POST") {
            return {status: 200, data: {id: "role_new", name: "New Role"}, requestId: "r"};
          }
          if (req.path === "/api/business/:businessId/users/role/:roleId" && req.method === "PUT") {
            return {status: 200, data: {id: "role_1", name: "Updated"}, requestId: "r"};
          }
          if (req.path === "/api/business/:businessId/users/role/:roleId" && req.method === "DELETE") {
            return {status: 200, data: {message: "ok"}, requestId: "r"};
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

import rolesCreate from "../../src/commands/roles/add";
import rolesUpdate from "../../src/commands/roles/update";
import rolesDelete from "../../src/commands/roles/delete";

beforeEach(() => {
  mock.reset();
  process.exitCode = 0;
});

describe("roles add", () => {
  // A GET precedes the POST: existing role names are read so the dashboard's
  // case-insensitive duplicate rule can be applied before creating anything.
  const postOf = (reqs: Array<{method: string}>) => reqs.find((r) => r.method === "POST");

  it("POSTs with name, description, and repeated --permission flags", async () => {
    await (rolesCreate.run as any)({
      args: {name: "New Role", description: "desc"},
      rawArgs: ["--permission", "perm_1", "--permission", "perm_2"]
    });
    const post = postOf(mock.requests as any);
    expect(post).toBeDefined();
    expect((post as any).body).toMatchObject({
      name: "New Role",
      description: "desc",
      permissionIds: ["perm_1", "perm_2"]
    });
  });

  it("omits permissionIds when no --permission flags are given", async () => {
    await (rolesCreate.run as any)({args: {name: "New Role"}, rawArgs: []});
    expect((postOf(mock.requests as any) as any).body).not.toHaveProperty("permissionIds");
  });

  it("errors (exit 3) on a name shorter than the dashboard's 3-character minimum", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await (rolesCreate.run as any)({args: {name: "ab"}, rawArgs: []});
    expect(process.exitCode).toBe(3);
    expect(postOf(mock.requests as any)).toBeUndefined();
    stderr.mockRestore();
  });

  it("errors (exit 3) when --name is missing on a non-TTY run", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (rolesCreate.run as any)({args: {}, rawArgs: []});
    expect(process.exitCode).toBe(3);
    stderr.mockRestore();
  });

  it("--dryRun does not send a request", async () => {
    await (rolesCreate.run as any)({args: {name: "New Role", dryRun: true}, rawArgs: []});
    expect(mock.requests).toHaveLength(0);
  });
});

describe("roles update", () => {
  it("PUTs the given roleId, keeping unset fields from the existing role, without touching permissions when --permission is omitted", async () => {
    await (rolesUpdate.run as any)({args: {roleId: "role_1", description: "new desc"}, rawArgs: []});
    const putReq = mock.requests.find((r) => r.method === "PUT");
    expect(putReq).toBeDefined();
    expect(putReq!.pathParams).toMatchObject({roleId: "role_1"});
    expect(putReq!.body).toMatchObject({name: "Cashier", description: "new desc"});
    expect(putReq!.body).not.toHaveProperty("permissionIds");
  });

  it("includes permissionIds (even replacing with a smaller set) when --permission flags are given", async () => {
    await (rolesUpdate.run as any)({args: {roleId: "role_1"}, rawArgs: ["--permission", "perm_2"]});
    const putReq = mock.requests.find((r) => r.method === "PUT");
    expect(putReq!.body).toMatchObject({permissionIds: ["perm_2"]});
  });

  it("errors (exit 3) when roleId is omitted on a non-TTY run", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (rolesUpdate.run as any)({args: {}, rawArgs: []});
    expect(process.exitCode).toBe(3);
    stderr.mockRestore();
  });
});

describe("roles delete", () => {
  it("DELETEs by roleId when --yes is passed", async () => {
    await (rolesDelete.run as any)({args: {roleId: "role_1", yes: true}, rawArgs: []});
    const delReq = mock.requests.find((r) => r.method === "DELETE");
    expect(delReq).toBeDefined();
    expect(delReq!.pathParams).toMatchObject({roleId: "role_1"});
  });

  it("errors (exit 3) when --yes is omitted on a non-TTY run", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (rolesDelete.run as any)({args: {roleId: "role_1"}, rawArgs: []});
    expect(process.exitCode).toBe(3);
    expect(mock.requests.some((r) => r.method === "DELETE")).toBe(false);
    stderr.mockRestore();
  });
});
