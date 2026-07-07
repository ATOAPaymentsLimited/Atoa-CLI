import {describe, it, expect, vi, beforeEach} from "vitest";

/**
 * business list + business use tests.
 *
 * Verifies:
 *   - business list → GET /api/business/, marks active one
 *   - business use → validates id, calls setActiveBusinessId, confirms to user
 *   - business use with invalid id → errors, lists valid ids
 */

// /api/business/ returns {business: BusinessToUser[], ...}, each entry's `.business`
// is the merchant whose id the CLI binds to and whose businessInfo holds the name.
const BUSINESSES = {
  business: [
    {id: "map_1", business: {id: "biz_1", status: "active", businessInfo: {legalBusinessName: "Acme Ltd"}}},
    {id: "map_2", business: {id: "biz_2", status: "active", businessInfo: {legalBusinessName: "Beta Corp"}}}
  ]
};

const mock = vi.hoisted(() => {
  const requests: Array<{method: string; path: string; auth?: string}> = [];
  let printed: unknown = undefined;
  let activeBusinessId: string | undefined = "biz_1";
  let setActiveCalledWith: string | undefined = undefined;

  return {
    requests,
    getPrinted: () => printed,
    setActiveBusinessId_called: () => setActiveCalledWith,
    setActiveBusinessId_reset() {
      setActiveCalledWith = undefined;
    },
    setActiveBusinessId_impl: async (profile: string, id: string) => {
      setActiveCalledWith = id;
    },
    setActiveBusinessIdValue(id: string | undefined) {
      activeBusinessId = id;
    },
    getActiveBusinessId: async (_profile: string) => activeBusinessId,
    reset() {
      requests.length = 0;
      printed = undefined;
      activeBusinessId = "biz_1";
      setActiveCalledWith = undefined;
    },
    buildContext: async (_opts: any) => ({
      env: "sandbox",
      http: {
        baseUrl: "https://api.atoa.me",
        request: async (req: any) => {
          requests.push({method: req.method, path: req.path, auth: req.auth});
          if (req.path === "/api/business/") {
            return {status: 200, data: BUSINESSES, requestId: "r"};
          }
          return {status: 200, data: {}, requestId: "r"};
        }
      },
      format: "json",
      verbose: false,
      dryRun: false,
      yes: true,
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
  return {
    ...actual,
    getActiveBusinessId: mock.getActiveBusinessId,
    setActiveBusinessId: mock.setActiveBusinessId_impl
  };
});

import businessList from "../../src/commands/business/list";
import businessUse from "../../src/commands/business/use";

beforeEach(() => {
  mock.reset();
  process.exitCode = 0;
});

describe("business list", () => {
  it("GETs /api/business/ with jwt auth", async () => {
    await (businessList.run as any)({args: {}, rawArgs: []});
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].method).toBe("GET");
    expect(mock.requests[0].path).toBe("/api/business/");
    expect(mock.requests[0].auth).toBe("jwt");
  });

  it("marks the active business with active: true", async () => {
    mock.setActiveBusinessIdValue("biz_2");
    await (businessList.run as any)({args: {}, rawArgs: []});
    const data = mock.getPrinted() as Array<{id: string; active: boolean}>;
    expect(Array.isArray(data)).toBe(true);

    const b1 = data.find((b) => b.id === "biz_1");
    const b2 = data.find((b) => b.id === "biz_2");
    expect(b1?.active).toBe(false);
    expect(b2?.active).toBe(true);
  });

  it("marks none active when activeBusinessId is undefined", async () => {
    mock.setActiveBusinessIdValue(undefined);
    await (businessList.run as any)({args: {}, rawArgs: []});
    const data = mock.getPrinted() as Array<{id: string; active: boolean}>;
    expect(data.every((b) => b.active === false)).toBe(true);
  });
});

describe("business use", () => {
  it("calls setActiveBusinessId with the valid business ID", async () => {
    await (businessUse.run as any)({args: {businessId: "biz_2"}, rawArgs: ["biz_2"]});
    expect(mock.setActiveBusinessId_called()).toBe("biz_2");
  });

  it("prints confirmation with legalBusinessName", async () => {
    await (businessUse.run as any)({args: {businessId: "biz_1"}, rawArgs: ["biz_1"]});
    const data = mock.getPrinted() as Record<string, unknown>;
    expect(data.activeBusinessId).toBe("biz_1");
    expect(data.legalBusinessName).toBe("Acme Ltd");
    expect(data.profile).toBe("acme");
  });

  it("writes success message to stdout (interactive TTY)", async () => {
    const origTTY = (process.stdout as any).isTTY;
    (process.stdout as any).isTTY = true; // human view only fires in a TTY
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (businessUse.run as any)({args: {businessId: "biz_1"}, rawArgs: ["biz_1"]});
    const out = stdout.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toMatch(/Acme Ltd/);
    expect(out).toMatch(/biz_1/);
    stdout.mockRestore();
    (process.stdout as any).isTTY = origTTY;
  });

  it("errors with not_found for an invalid business ID and lists valid IDs", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (businessUse.run as any)({args: {businessId: "biz_invalid"}, rawArgs: ["biz_invalid"]});
    expect(process.exitCode).toBe(4); // not_found
    const errOut = stderr.mock.calls.map((c) => String(c[0])).join("");
    expect(errOut).toMatch(/biz_1/);
    expect(errOut).toMatch(/biz_2/);
    stderr.mockRestore();
  });

  it("does not set active business when ID is invalid", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (businessUse.run as any)({args: {businessId: "bad_id"}, rawArgs: ["bad_id"]});
    expect(mock.setActiveBusinessId_called()).toBeUndefined();
    stderr.mockRestore();
  });

  it("fetches /api/business/ to validate", async () => {
    await (businessUse.run as any)({args: {businessId: "biz_1"}, rawArgs: ["biz_1"]});
    expect(mock.requests.some((r) => r.path === "/api/business/")).toBe(true);
  });
});
