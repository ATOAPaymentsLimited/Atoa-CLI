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
          // `stores add` checks the plan first, then the bank account, before it prompts.
          if (req.path === "/api/addonPlan/merchant/:businessId/current" && req.method === "GET") {
            return {status: 200, data: {addonPlan: {addonFeatureToAddonPlans: mock.planFeatures}}, requestId: "r"};
          }
          if (req.path === "/api/merchant/addonPlan/:businessId/featureUsage" && req.method === "GET") {
            return {status: 200, data: mock.featureUsage, requestId: "r"};
          }
          if (req.path === "/api/merchant/:businessId/bank-account" && req.method === "GET") {
            return {status: 200, data: mock.bankAccounts, requestId: "r"};
          }
          if (req.path === "/api/business/:businessId/stores/" && req.method === "GET") {
            return {status: 200, data: mock.storesList, requestId: "r"};
          }
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
    // A plan with room for another store, so the pre-flight reaches the bank-account check.
    planFeatures: [{limit: 5, addonFeature: {addonFeatureType: "MULTI_STORE", overlimitCharges: 0}}] as unknown[],
    featureUsage: [{featureType: "MULTI_STORE", usage: 1}] as unknown[],
    // The business's bank accounts, as `stores add`'s pre-flight check sees them.
    bankAccounts: [{id: "bank_1"}] as unknown[],
    // Consulted only when there are no business bank accounts: a store may still have one linked.
    storesList: [] as unknown[],
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
  mock.planFeatures = [{limit: 5, addonFeature: {addonFeatureType: "MULTI_STORE", overlimitCharges: 0}}];
  mock.featureUsage = [{featureType: "MULTI_STORE", usage: 1}];
  mock.bankAccounts = [{id: "bank_1"}];
  mock.storesList = [];
  process.exitCode = 0;
});

describe("stores add", () => {
  it("POSTs the store upsert route with a multipart rawBody", async () => {
    await (storesAdd.run as any)({
      args: {locationName: "New Store", addressLine1: "1 Test Rd", addressPostalCode: "SW1 1AA", cityOrTown: "London"},
      rawArgs: []
    });
    const post = mock.requests.find((r) => r.method === "POST");
    expect(post).toBeDefined();
    expect(post!.path).toBe("/api/merchant/:businessId/store");
    expect(post!.rawBody).toBeDefined();
  });

  it("refuses with the add-a-bank-account message when the business has none", async () => {
    mock.bankAccounts = [];
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

    expect(printedError).toContain("haven't linked a bank account");
    expect(printedError).toContain("atoa bank add");
    // Refused before the upsert, so no store was created.
    expect(mock.requests.some((r) => r.method === "POST")).toBe(false);
    expect(process.exitCode).toBe(3);
  });

  // A business still on its single DEFAULT location renames that one instead of gaining a second,
  // so no MULTI_STORE limit applies.
  it("updates the DEFAULT store in place when it is the only one", async () => {
    mock.storesList = [{id: "st_default", locationName: "DEFAULT", bankAccount: {bankName: "Lloyds"}}];
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await (storesAdd.run as any)({
      args: {locationName: "Soho", addressLine1: "1 Test Rd", addressPostalCode: "SW1 1AA", cityOrTown: "London"},
      rawArgs: []
    });
    stderr.mockRestore();

    const post = mock.requests.find((r) => r.method === "POST");
    expect(post).toBeDefined();
    // An id on the upsert makes it an update rather than a create.
    expect(post!.rawBody?.get("id")).toBe("st_default");
    expect(post!.rawBody?.get("locationName")).toBe("Soho");
  });

  // The preview has to agree with the run it previews. Skipping the gate under --dryRun described
  // a create for a business whose real run would have renamed the DEFAULT location in place.
  it("--dryRun previews the rename, not a create, when DEFAULT is the only store", async () => {
    mock.storesList = [{id: "st_default", locationName: "DEFAULT", bankAccount: {bankName: "Lloyds"}}];

    await (storesAdd.run as any)({
      args: {
        locationName: "Soho",
        addressLine1: "1 Test Rd",
        addressPostalCode: "SW1 1AA",
        cityOrTown: "London",
        dryRun: true
      },
      rawArgs: []
    });

    expect((mock.getPrinted() as any).body).toMatchObject({id: "st_default", locationName: "Soho"});
    expect(mock.requests.every((r) => r.method === "GET")).toBe(true);
  });

  it("creates a new store when the DEFAULT one has already been renamed", async () => {
    mock.storesList = [{id: "st_1", locationName: "Soho", bankAccount: {bankName: "Lloyds"}}];

    await (storesAdd.run as any)({
      args: {locationName: "Camden", addressLine1: "2 Test Rd", addressPostalCode: "SW1 1AA", cityOrTown: "London"},
      rawArgs: []
    });

    const post = mock.requests.find((r) => r.method === "POST");
    expect(post!.rawBody?.get("id")).toBeNull(); // no id -> create
  });

  it("skips the plan check entirely when renaming the DEFAULT store", async () => {
    // Basic-style plan: MULTI_STORE absent. Renaming isn't an additional location, so it proceeds.
    mock.planFeatures = [];
    mock.storesList = [{id: "st_default", locationName: "DEFAULT", bankAccount: {bankName: "Lloyds"}}];
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await (storesAdd.run as any)({
      args: {locationName: "Soho", addressLine1: "1 Test Rd", addressPostalCode: "SW1 1AA", cityOrTown: "London"},
      rawArgs: []
    });
    stderr.mockRestore();

    expect(mock.requests.some((r) => r.method === "POST")).toBe(true);
    expect(process.exitCode).toBe(0);
  });

  it("defers to the plan refusal when the plan is the binding constraint, even with no bank account", async () => {
    // Both blockers present. The plan is checked first, so telling the merchant to add a bank
    // account they still couldn't use would be the wrong answer.
    mock.planFeatures = []; // MULTI_STORE not in the plan at all
    mock.bankAccounts = [];
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
    expect(printedError).not.toContain("bank account");
  });

  it("still adds the store when no business bank account exists but a store already has one linked", async () => {
    mock.bankAccounts = [];
    mock.storesList = [{id: "st_1", bankAccount: {bankName: "Lloyds"}}];
    await (storesAdd.run as any)({
      args: {locationName: "New Store", addressLine1: "1 Test Rd", addressPostalCode: "SW1 1AA", cityOrTown: "London"},
      rawArgs: []
    });
    expect(mock.requests.some((r) => r.method === "POST")).toBe(true);
  });

  // The gate reads (stores, bank, plan) so the preview can say whether this would create or rename,
  // and whether it would be refused at all. What --dryRun must never do is write.
  it("--dryRun reads but sends no write", async () => {
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
    expect(mock.requests.every((r: {method: string}) => r.method === "GET")).toBe(true);
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
        // Space stripped: the dashboard's postcode input blocks the space key, so this is
        // the value that form would have produced.
        addressPostalCode: "SW11AA"
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
      expect(printed.body.addressPostalCode).toBe("SW11AA");
    });

    it("re-prompts instead of aborting when a flag value fails the dashboard's rule", async () => {
      const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
      vi.mocked(prompts.input).mockResolvedValueOnce("New Store"); // replacement locationName

      await (storesAdd.run as any)({
        args: {
          locationName: "ab", // under the 3-character minimum
          addressLine1: "1 Test Rd",
          addressPostalCode: "SW11AA",
          cityOrTown: "London",
          dryRun: true
        },
        rawArgs: []
      });

      expect(prompts.input).toHaveBeenCalledTimes(1);
      expect((mock.getPrinted() as any).body.locationName).toBe("New Store");
      stderr.mockRestore();
    });

    it('rejects the reserved store name "default"', async () => {
      const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
      vi.mocked(prompts.input).mockResolvedValueOnce("Real Store");

      await (storesAdd.run as any)({
        args: {
          locationName: "Default",
          addressLine1: "1 Test Rd",
          addressPostalCode: "SW11AA",
          cityOrTown: "London",
          dryRun: true
        },
        rawArgs: []
      });

      expect(prompts.input).toHaveBeenCalledTimes(1);
      stderr.mockRestore();
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
