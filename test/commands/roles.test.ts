import {describe, it, expect, vi, beforeEach} from "vitest";

/**
 * Task 7: roles list tests.
 */

const mock = vi.hoisted(() => {
  const requests: Array<{method: string; path: string; auth?: string; query?: any}> = [];
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
          requests.push({method: req.method, path: req.path, auth: req.auth, query: req.query});
          // Pagination<RoleEntityV2> envelope — fetchAllPages reads `.data`.
          return {
            status: 200,
            data: {
              data: [{id: "role_1", name: "Admin", description: "Full access", roleScopeType: "BUSINESS"}],
              totalCount: 1
            },
            requestId: "r"
          };
        }
      },
      format: "json",
      verbose: false,
      dryRun: opts.dryRun ?? false,
      yes: false,
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

import rolesList from "../../src/commands/roles/list";

beforeEach(() => {
  mock.reset();
  process.exitCode = 0;
});

describe("roles list", () => {
  it("GETs /api/business/:businessId/users/role/ with jwt auth", async () => {
    await (rolesList.run as any)({args: {}, rawArgs: []});
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].method).toBe("GET");
    expect(mock.requests[0].path).toBe("/api/business/:businessId/users/role/");
    expect(mock.requests[0].auth).toBe("jwt");
  });

  it("prints the roles list", async () => {
    await (rolesList.run as any)({args: {}, rawArgs: []});
    const data = mock.getPrinted() as any[];
    expect(Array.isArray(data)).toBe(true);
    expect(data[0].name).toBe("Admin");
  });

  it("--dryRun does not send a request", async () => {
    await (rolesList.run as any)({args: {dryRun: true}, rawArgs: []});
    expect(mock.requests).toHaveLength(0);
  });
});
