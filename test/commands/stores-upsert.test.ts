import {describe, it, expect, vi, beforeEach, afterEach} from "vitest";

// Mock @inquirer/prompts so tests never wait for real TTY input.
vi.mock("@inquirer/prompts", () => ({
  input: vi.fn(async () => "")
}));

const mock = vi.hoisted(() => {
  const requests: Array<{
    method: string;
    path: string;
    auth?: string;
    query?: any;
    body?: any;
    pathParams?: any;
    rawBody?: any;
  }> = [];
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
          requests.push({
            method: req.method,
            path: req.path,
            auth: req.auth,
            query: req.query,
            body: req.body,
            pathParams: req.pathParams,
            rawBody: req.rawBody
          });
          if (req.path === "/api/business/:businessId/stores/:storeId" && req.method === "GET") {
            return {
              status: 200,
              data: {
                id: "st_1",
                locationName: "Old Name",
                addressLine1: "1 Old St",
                addressPostalCode: "SW1 1AA",
                cityOrTown: "London"
              },
              requestId: "r"
            };
          }
          if (req.path === "/api/merchant/:businessId/store" && req.method === "POST") {
            if (mock.rejectUpsert) {
              const {AtoaError} = await import("../../src/lib/errors");
              throw new AtoaError("store limit reached", "forbidden", {
                status: 403,
                errorCode: "ADDON_UPGRADE_REQUIRED"
              });
            }
            return {status: 200, data: {id: "st_new", locationName: "New Store"}, requestId: "r"};
          }
          return {status: 200, data: {}, requestId: "r"};
        }
      },
      format: "json",
      formatExplicit: mock.formatExplicit,
      verbose: false,
      dryRun: opts.dryRun ?? false,
      yes: opts.yes ?? false,
      authFingerprint: "RnIs",
      profileName: "acme",
      profile: {businessId: "biz_1", displayName: "Acme", envs: {sandbox: {tokenFingerprint: "x"}}},
      print: (data: unknown) => {
        printed = data;
      }
    }),
    rejectUpsert: false,
    // Existing tests rely on isInteractive() always being false (they pass no --output
    // and don't fake a TTY); the new stores-add wizard tests flip this to exercise prompting.
    formatExplicit: true
  };
});

vi.mock("../../src/lib/context", async () => {
  const actual = await vi.importActual<any>("../../src/lib/context");
  return {...actual, buildContext: mock.buildContext};
});

import storesAdd from "../../src/commands/stores/add";
import storesUpdate from "../../src/commands/stores/update";
import * as prompts from "@inquirer/prompts";

beforeEach(() => {
  mock.reset();
  mock.rejectUpsert = false;
  mock.formatExplicit = true;
  process.exitCode = 0;
});

describe("stores add", () => {
  it("POSTs the store upsert route with a multipart rawBody", async () => {
    await (storesAdd.run as any)({
      args: {locationName: "New Store", addressLine1: "1 Test Rd", addressPostalCode: "SW1 1AA", cityOrTown: "London"},
      rawArgs: []
    });
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].method).toBe("POST");
    expect(mock.requests[0].path).toBe("/api/merchant/:businessId/store");
    expect(mock.requests[0].rawBody).toBeDefined();
  });

  it("--dryRun does not send a request", async () => {
    await (storesAdd.run as any)({
      args: {
        locationName: "New Store",
        addressLine1: "1 Test Rd",
        addressPostalCode: "SW1 1AA",
        cityOrTown: "London",
        dryRun: true
      },
      rawArgs: []
    });
    expect(mock.requests).toHaveLength(0);
  });

  it("errors when --location-name is missing", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (storesAdd.run as any)({
      args: {addressLine1: "1 Test Rd", addressPostalCode: "SW1 1AA", cityOrTown: "London"},
      rawArgs: []
    });
    expect(process.exitCode).toBe(3);
    stderr.mockRestore();
  });

  describe("interactive wizard (TTY, no --output)", () => {
    const origTTY = process.stdout.isTTY;

    beforeEach(() => {
      mock.formatExplicit = false;
      (process.stdout as any).isTTY = true;
      vi.mocked(prompts.input).mockReset();
    });

    afterEach(() => {
      (process.stdout as any).isTTY = origTTY;
    });

    it("prompts step-by-step for every omitted field, in order", async () => {
      vi.mocked(prompts.input)
        .mockResolvedValueOnce("New Store") // locationName
        .mockResolvedValueOnce("1 Test Rd") // addressLine1
        .mockResolvedValueOnce("") // addressLine2 (optional, skipped)
        .mockResolvedValueOnce("London") // cityOrTown
        .mockResolvedValueOnce("SW1 1AA"); // addressPostalCode

      await (storesAdd.run as any)({args: {dryRun: true}, rawArgs: []});

      expect(prompts.input).toHaveBeenCalledTimes(5);
      const printed = mock.getPrinted() as any;
      expect(printed.body).toMatchObject({
        locationName: "New Store",
        addressLine1: "1 Test Rd",
        cityOrTown: "London",
        addressPostalCode: "SW1 1AA"
      });
      expect(printed.body.addressLine2).toBeUndefined();
    });

    it("only prompts for the fields not already given as flags", async () => {
      vi.mocked(prompts.input).mockResolvedValueOnce("SW1 1AA"); // addressPostalCode only

      await (storesAdd.run as any)({
        args: {
          locationName: "New Store",
          addressLine1: "1 Test Rd",
          addressLine2: "Unit 2",
          cityOrTown: "London",
          dryRun: true
        },
        rawArgs: []
      });

      expect(prompts.input).toHaveBeenCalledTimes(1);
      const printed = mock.getPrinted() as any;
      expect(printed.body.addressPostalCode).toBe("SW1 1AA");
    });

    it("does not prompt at all when every flag is already provided", async () => {
      await (storesAdd.run as any)({
        args: {
          locationName: "New Store",
          addressLine1: "1 Test Rd",
          addressPostalCode: "SW1 1AA",
          cityOrTown: "London",
          dryRun: true
        },
        rawArgs: []
      });

      expect(prompts.input).not.toHaveBeenCalled();
    });
  });

  it("surfaces ADDON_UPGRADE_REQUIRED with an upgrade hint", async () => {
    mock.rejectUpsert = true;
    let printedError = "";
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk: any) => {
      printedError += chunk;
      return true;
    });
    await (storesAdd.run as any)({
      args: {locationName: "New Store", addressLine1: "1 Test Rd", addressPostalCode: "SW1 1AA", cityOrTown: "London"},
      rawArgs: []
    });
    stderr.mockRestore();
    expect(printedError).toContain("atoa addons list");
  });
});

describe("stores update", () => {
  it("prefills omitted fields from the current store, then upserts", async () => {
    await (storesUpdate.run as any)({args: {storeId: "st_1", locationName: "Renamed Store"}, rawArgs: []});
    const upsertReq = mock.requests.find((r) => r.method === "POST");
    expect(upsertReq).toBeDefined();
  });

  it("errors when storeId is omitted on a non-TTY run", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (storesUpdate.run as any)({args: {}, rawArgs: []});
    expect(process.exitCode).toBe(3);
    stderr.mockRestore();
  });

  it("--dryRun does not send the upsert request", async () => {
    await (storesUpdate.run as any)({args: {storeId: "st_1", dryRun: true}, rawArgs: []});
    // The GET prefill still runs; only the upsert POST is skipped.
    expect(mock.requests.some((r) => r.method === "POST")).toBe(false);
  });
});
