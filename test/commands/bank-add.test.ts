import {describe, it, expect, vi, beforeEach, afterEach} from "vitest";

// Mock @inquirer/prompts so tests never wait for real TTY input.
vi.mock("@inquirer/prompts", () => ({
  input: vi.fn(async () => ""),
  confirm: vi.fn(async () => false),
  select: vi.fn(async () => undefined)
}));

const mock = vi.hoisted(() => {
  const requests: Array<{method: string; path: string; body?: any}> = [];
  return {
    requests,
    reset() {
      requests.length = 0;
    },
    buildContext: async (opts: any) => ({
      env: "sandbox",
      http: {
        baseUrl: "https://api.atoa.me",
        request: async (req: any) => {
          requests.push({method: req.method, path: req.path, body: req.body});
          if (req.path === "/api/business/:businessId/bank/" && req.method === "POST") {
            return {status: 200, data: {id: "bank_new", bankName: req.body?.bankName}, requestId: "r"};
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
      print: () => {}
    })
  };
});

vi.mock("../../src/lib/context", async () => {
  const actual = await vi.importActual<any>("../../src/lib/context");
  return {...actual, buildContext: mock.buildContext};
});

import bankAdd from "../../src/commands/bank/add";
import * as prompts from "@inquirer/prompts";

const BASE_ARGS = {bankName: "ATOA Test Bank", accountHolderName: "Cli Probe", dryRun: true};

describe("bank add — sort code and account number validation", () => {
  const origStdinTTY = process.stdin.isTTY;

  beforeEach(() => {
    mock.reset();
    process.exitCode = 0;
    (process.stdin as {isTTY?: boolean}).isTTY = false;
  });

  afterEach(() => {
    (process.stdin as {isTTY?: boolean}).isTTY = origStdinTTY;
  });

  // Reproduces the reported bug: a sort code that is neither 6 digits nor numeric ("SWA1A1AA",
  // a postcode-shaped typo) used to pass straight through to the backend instead of being
  // rejected client-side, wasting a network round trip for an error the CLI could have caught.
  it("rejects a non-numeric --sort-code before any network call (non-interactive)", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (bankAdd.run as any)({
      args: {...BASE_ARGS, sortCode: "SWA1A1AA", accountNumber: "13487215"},
      rawArgs: []
    });
    stderr.mockRestore();

    expect(process.exitCode).toBe(3);
    expect(mock.requests).toHaveLength(0);
  });

  it("rejects a --sort-code of the wrong length before any network call", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (bankAdd.run as any)({
      args: {...BASE_ARGS, sortCode: "12345", accountNumber: "13487215"},
      rawArgs: []
    });
    stderr.mockRestore();

    expect(process.exitCode).toBe(3);
    expect(mock.requests).toHaveLength(0);
  });

  it("rejects a non-numeric --account-number before any network call", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (bankAdd.run as any)({
      args: {...BASE_ARGS, sortCode: "234567", accountNumber: "1348AAAA"},
      rawArgs: []
    });
    stderr.mockRestore();

    expect(process.exitCode).toBe(3);
    expect(mock.requests).toHaveLength(0);
  });

  // Sort codes are printed as "12-34-56" on cards and statements; the pre-validation path used to
  // accept spaces and strip them, so the rule normalises rather than rejecting.
  it.each([["12 34 56"], ["12-34-56"], ["  234567  "]])("accepts a sort code written as %s", async (sortCode) => {
    await (bankAdd.run as any)({
      args: {...BASE_ARGS, sortCode, accountNumber: "13487215"},
      rawArgs: []
    });
    expect(process.exitCode).toBe(0);
  });

  it("normalises the sort code before sending it", async () => {
    await (bankAdd.run as any)({
      args: {
        bankName: "ATOA Test Bank",
        accountHolderName: "Cli Probe",
        sortCode: "12-34-56",
        accountNumber: "13487215"
      },
      rawArgs: []
    });
    const post = mock.requests.find((r) => r.method === "POST");
    expect(post?.body?.sortCode).toBe("123456");
  });

  it("accepts a valid sort code and account number and reaches the request", async () => {
    await (bankAdd.run as any)({
      args: {...BASE_ARGS, sortCode: "234567", accountNumber: "13487215"},
      rawArgs: []
    });
    // --dryRun: no bank.add POST, but no validation error either — exit stays 0.
    expect(process.exitCode).toBe(0);
  });

  it("on a TTY, re-prompts for a corrected sort code instead of sending the invalid one", async () => {
    (process.stdin as {isTTY?: boolean}).isTTY = true;
    vi.mocked(prompts.input).mockReset();
    vi.mocked(prompts.input).mockResolvedValueOnce("234567"); // the corrected sort code

    await (bankAdd.run as any)({
      args: {...BASE_ARGS, sortCode: "SWA1A1AA", accountNumber: "13487215"},
      rawArgs: []
    });

    expect(prompts.input).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(0);
  });

  it("wires validateSortCode as the prompt's own validator, so inquirer itself rejects a bad retype", async () => {
    (process.stdin as {isTTY?: boolean}).isTTY = true;
    vi.mocked(prompts.input).mockReset();
    vi.mocked(prompts.input).mockImplementationOnce(async (o: any) => {
      expect(o.validate("SWA1A1AA")).not.toBe(true); // still rejected
      expect(o.validate("234567")).toBe(true); // accepted
      return "234567";
    });

    await (bankAdd.run as any)({
      args: {...BASE_ARGS, sortCode: "SWA1A1AA", accountNumber: "13487215"},
      rawArgs: []
    });

    expect(process.exitCode).toBe(0);
  });
});
