import {describe, it, expect, vi, beforeEach} from "vitest";

/**
 * `bank.get` is a different route family from `bank.list`, and the two disagree about envelopes
 * elsewhere in the API — a `{data: …}` wrapper here would make projectBankAccount read every field
 * off the wrapper and print a record of blanks. Verified against dev: it returns a bare object.
 */
const mock = vi.hoisted(() => {
  const requests: Array<{method: string; path: string; pathParams?: Record<string, string>}> = [];
  let printed: unknown;
  let responseData: unknown = {};
  return {
    requests,
    getPrinted: () => printed,
    setResponse(data: unknown) {
      responseData = data;
    },
    reset() {
      requests.length = 0;
      printed = undefined;
      responseData = {};
    },
    buildContext: async (opts: any) => ({
      env: "sandbox",
      http: {
        baseUrl: "https://api.atoa.me",
        request: async (req: any) => {
          requests.push({method: req.method, path: req.path, pathParams: req.pathParams});
          return {status: 200, data: responseData, requestId: "r"};
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

import bankGet from "../../src/commands/bank/get";

// The exact body dev returns for GET /api/business/:businessId/bank/:id.
const LIVE_SHAPE = {
  id: "157b711a-83fe-4665-99f6-7e38c2798ba2",
  bankName: "Wise",
  nickName: null,
  sortCode: "712345",
  maskedAccountNumber: "XXXX4567",
  accountHolderName: "Bud G",
  currency: "GBP",
  enabled: true,
  copVerified: "APPROVED"
};

describe("bank get", () => {
  beforeEach(() => {
    mock.reset();
    process.exitCode = 0;
  });

  it("projects a bare (unenveloped) response without dropping fields", async () => {
    mock.setResponse(LIVE_SHAPE);
    await (bankGet.run as any)({args: {id: LIVE_SHAPE.id}, rawArgs: []});

    expect(mock.getPrinted()).toEqual({
      id: LIVE_SHAPE.id,
      bankName: "Wise",
      nickName: null,
      sortCode: "712345",
      maskedAccountNumber: "XXXX4567",
      accountHolderName: "Bud G",
      currency: "GBP",
      enabled: true,
      copVerified: "APPROVED"
    });
  });

  // The full number must not reach the terminal even if a future route starts returning it.
  it("never prints accountNumber or iban", async () => {
    mock.setResponse({...LIVE_SHAPE, accountNumber: "12344567", iban: "GB29NWBK60161331926819"});
    await (bankGet.run as any)({args: {id: LIVE_SHAPE.id}, rawArgs: []});

    const out = mock.getPrinted() as Record<string, unknown>;
    expect(out).not.toHaveProperty("accountNumber");
    expect(out).not.toHaveProperty("iban");
    expect(JSON.stringify(out)).not.toContain("12344567");
  });

  it("sends the id as a path param", async () => {
    mock.setResponse(LIVE_SHAPE);
    await (bankGet.run as any)({args: {id: `  ${LIVE_SHAPE.id}  `}, rawArgs: []});

    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0]?.pathParams).toEqual({id: LIVE_SHAPE.id});
  });

  it("--dryRun resolves the route without sending", async () => {
    await (bankGet.run as any)({args: {id: LIVE_SHAPE.id, dryRun: true}, rawArgs: []});

    expect(mock.requests).toHaveLength(0);
    expect(mock.getPrinted()).toMatchObject({pathParams: {id: LIVE_SHAPE.id}});
  });

  it("refuses an empty id without calling the API", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (bankGet.run as any)({args: {id: "   "}, rawArgs: []});
    stderr.mockRestore();

    expect(process.exitCode).toBe(3);
    expect(mock.requests).toHaveLength(0);
  });
});
