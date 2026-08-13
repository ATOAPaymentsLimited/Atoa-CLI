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
    configExists: true,
    linkedLocations: [] as Array<{merchantStoreId?: string}>,
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
          if (
            req.path === "/api/review-system/merchant-business-config/v1/:businessId/Google" &&
            req.method === "GET"
          ) {
            if (!mock.configExists) {
              const {AtoaError} = await import("../../src/lib/errors");
              throw new AtoaError("not found", "not_found", {status: 404});
            }
            return {status: 200, data: {platformBusinessId: "acct_1", disableCollectingReviews: false}, requestId: "r"};
          }
          if (req.path === "/api/review-system/merchant-stores/:businessId/Google" && req.method === "GET") {
            return {status: 200, data: mock.linkedLocations, requestId: "r"};
          }
          if (
            req.path === "/api/review-system/merchant-stores/:businessId/Google/unlink-location/:merchantStoreId" &&
            req.method === "DELETE"
          ) {
            return {status: 200, data: {}, requestId: "r"};
          }
          if (
            req.path === "/api/review-system/merchant-business-config/merchant/:businessId/Google" &&
            req.method === "DELETE"
          ) {
            return {status: 200, data: true, requestId: "r"};
          }
          if (req.path === "/api/review-system/merchant-stores/search-google-locations" && req.method === "GET") {
            return {
              status: 200,
              data: [{name: "Acme Cafe", formatted_address: "1 High St", place_id: "place_1"}],
              requestId: "r"
            };
          }
          if (req.path === "/api/business/:businessId/stores/" && req.method === "GET") {
            return {status: 200, data: [{id: "st_1", locationName: "Main Store"}], requestId: "r"};
          }
          if (
            req.path === "/api/review-system/merchant-stores/:businessId/Google/link-location" &&
            req.method === "POST"
          ) {
            return {status: 200, data: {}, requestId: "r"};
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

vi.mock("@inquirer/prompts", () => ({
  select: vi.fn(async ({choices}: any) => choices[0]?.value),
  confirm: vi.fn(async () => true)
}));

import googleReviewStatus from "../../src/commands/google-review/status";
import googleReviewLink from "../../src/commands/google-review/link";
import googleReviewUnlink from "../../src/commands/google-review/unlink";

beforeEach(() => {
  mock.reset();
  mock.configExists = true;
  mock.linkedLocations = [];
  process.exitCode = 0;
});

describe("google-review status", () => {
  it("GETs the v1 config route and prints it", async () => {
    await (googleReviewStatus.run as any)({args: {}, rawArgs: []});
    expect(mock.requests[0]).toMatchObject({
      method: "GET",
      path: "/api/review-system/merchant-business-config/v1/:businessId/Google"
    });
    expect(mock.getPrinted()).toMatchObject({platformBusinessId: "acct_1"});
  });

  it("prints connected:false on a 404 instead of throwing", async () => {
    mock.configExists = false;
    await (googleReviewStatus.run as any)({args: {}, rawArgs: []});
    expect(process.exitCode).toBe(0);
    expect(mock.getPrinted()).toMatchObject({connected: false});
  });
});

describe("google-review link", () => {
  it("headless (--place) search links straight to a chosen store, skipping OAuth", async () => {
    await (googleReviewLink.run as any)({args: {place: "Acme Cafe"}, rawArgs: []});
    const linkReq = mock.requests.find((r) => r.method === "POST" && r.path.includes("link-location"));
    expect(linkReq).toBeDefined();
    expect(linkReq!.body).toMatchObject({merchantStoreId: "st_1", placeId: "place_1"});
  });

  it("errors (exit 3) on a non-TTY run without --place", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (googleReviewLink.run as any)({args: {}, rawArgs: []});
    expect(process.exitCode).toBe(3);
    stderr.mockRestore();
  });
});

describe("google-review unlink", () => {
  it("errors (exit 3) when --yes is omitted on a non-TTY run", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (googleReviewUnlink.run as any)({args: {}, rawArgs: []});
    expect(process.exitCode).toBe(3);
    expect(mock.requests).toHaveLength(0);
    stderr.mockRestore();
  });

  it("unlinks every linked store location before deleting the merchant config", async () => {
    mock.linkedLocations = [{merchantStoreId: "st_1"}, {merchantStoreId: "st_2"}];
    await (googleReviewUnlink.run as any)({args: {yes: true}, rawArgs: []});
    const unlinkReqs = mock.requests.filter((r) => r.method === "DELETE" && r.path.includes("unlink-location"));
    expect(unlinkReqs).toHaveLength(2);
    const configDelete = mock.requests.find((r) => r.method === "DELETE" && r.path.endsWith("/Google"));
    expect(configDelete).toBeDefined();
    // Locations unlinked before the config delete.
    expect(mock.requests.indexOf(unlinkReqs[0])).toBeLessThan(mock.requests.indexOf(configDelete!));
  });
});
