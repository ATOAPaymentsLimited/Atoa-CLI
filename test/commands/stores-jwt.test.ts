import {describe, it, expect, vi, beforeEach} from "vitest";

/**
 * Task 7: stores jwt/sdk dispatch + stores get + stores link-bank tests.
 */

const mock = vi.hoisted(() => {
  const requests: Array<{method: string; path: string; auth?: string; pathParams?: any; body?: any; query?: any}> = [];
  let printed: unknown = undefined;
  let authMode: "jwt" | "sdk-paste" = "jwt";

  return {
    requests,
    getPrinted: () => printed,
    setAuthMode(m: "jwt" | "sdk-paste") {
      authMode = m;
    },
    reset() {
      requests.length = 0;
      printed = undefined;
      authMode = "jwt";
    },
    getAuthMode: async (_p: string, _e: string) => authMode,
    buildContext: async (opts: any) => ({
      env: "sandbox" as const,
      http: {
        baseUrl: "https://api.atoa.me",
        request: async (req: any) => {
          requests.push({
            method: req.method,
            path: req.path,
            auth: req.auth,
            pathParams: req.pathParams,
            body: req.body,
            query: req.query
          });
          if (req.path === "/api/business/:businessId/stores/" && req.method === "GET") {
            // Pagination<MerchantStoreEntity> envelope — fetchAllPages reads `.data`.
            return {
              status: 200,
              data: {
                data: [
                  {
                    id: "st_1",
                    locationName: "Main Store",
                    addressPostalCode: "SW1A 1AA",
                    cityOrTown: "London"
                  }
                ],
                totalCount: 1
              },
              requestId: "r"
            };
          }
          if (req.path === "/api/business/:businessId/stores/:storeId" && req.method === "GET") {
            return {
              status: 200,
              data: {
                id: "st_1",
                locationName: "Main Store",
                addressPostalCode: "SW1A 1AA",
                cityOrTown: "London"
              },
              requestId: "r"
            };
          }
          if (req.path === "/api/business/:businessId/stores/:storeId/bank") {
            return {status: 200, data: {id: "st_1", bankAccountId: "ba_1"}, requestId: "r"};
          }
          if (req.path === "/api/payments/stores") {
            return {status: 200, data: [{id: "st_legacy"}], requestId: "r"};
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

vi.mock("../../src/lib/config-store", async () => {
  const actual = await vi.importActual<any>("../../src/lib/config-store");
  return {...actual, getAuthMode: mock.getAuthMode};
});

import storesList from "../../src/commands/stores/list";
import storesGet from "../../src/commands/stores/get";
import storesLinkBank from "../../src/commands/stores/link-bank";

beforeEach(() => {
  mock.reset();
  process.exitCode = 0;
});

// ── stores list ──────────────────────────────────────────────────────────────

describe("stores list — jwt mode", () => {
  it("GETs /api/business/:businessId/stores/ with jwt auth", async () => {
    await (storesList.run as any)({args: {}, rawArgs: []});
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].method).toBe("GET");
    expect(mock.requests[0].path).toBe("/api/business/:businessId/stores/");
    expect(mock.requests[0].auth).toBe("jwt");
  });

  it("requests page=0,size=100 via fetchAllPages and prints the rows", async () => {
    await (storesList.run as any)({args: {}, rawArgs: []});
    expect(mock.requests[0].path).toBe("/api/business/:businessId/stores/");
    expect(mock.requests[0].query).toMatchObject({page: "0", size: "100"});
    const data = mock.getPrinted() as any[];
    expect(Array.isArray(data)).toBe(true);
    expect(data[0].id).toBe("st_1");
  });
});

// ── stores get ───────────────────────────────────────────────────────────────

describe("stores get — jwt mode", () => {
  it("GETs /api/business/:businessId/stores/:storeId with jwt auth", async () => {
    await (storesGet.run as any)({args: {storeId: "st_1"}, rawArgs: ["st_1"]});
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].method).toBe("GET");
    expect(mock.requests[0].path).toBe("/api/business/:businessId/stores/:storeId");
    expect(mock.requests[0].pathParams).toEqual({storeId: "st_1"});
    expect(mock.requests[0].auth).toBe("jwt");
  });

  it("--dryRun does not send a request", async () => {
    await (storesGet.run as any)({args: {storeId: "st_1", dryRun: true}, rawArgs: ["st_1"]});
    expect(mock.requests).toHaveLength(0);
  });
});

// ── stores link-bank ─────────────────────────────────────────────────────────

describe("stores link-bank", () => {
  it("PUTs /api/business/:businessId/stores/:storeId/bank with jwt auth", async () => {
    await (storesLinkBank.run as any)({args: {storeId: "st_1", bank: "ba_1"}, rawArgs: ["st_1"]});
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].method).toBe("PUT");
    expect(mock.requests[0].path).toBe("/api/business/:businessId/stores/:storeId/bank");
    expect(mock.requests[0].pathParams).toEqual({storeId: "st_1"});
    expect(mock.requests[0].body).toMatchObject({bankAccountId: "ba_1"});
    expect(mock.requests[0].auth).toBe("jwt");
  });

  it("errors when --bank is missing", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (storesLinkBank.run as any)({args: {storeId: "st_1"}, rawArgs: ["st_1"]});
    expect(process.exitCode).toBe(3);
    stderr.mockRestore();
  });

  it("--dryRun does not send a request", async () => {
    await (storesLinkBank.run as any)({args: {storeId: "st_1", bank: "ba_1", dryRun: true}, rawArgs: ["st_1"]});
    expect(mock.requests).toHaveLength(0);
  });
});
