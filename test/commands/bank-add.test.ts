import {describe, it, expect, vi, beforeEach, afterEach} from "vitest";

// Mock @inquirer/prompts so tests never wait for real TTY input.
vi.mock("@inquirer/prompts", () => ({
  input: vi.fn(async () => ""),
  confirm: vi.fn(async () => false),
  select: vi.fn(async () => undefined)
}));

const mock = vi.hoisted(() => {
  const requests: Array<{method: string; path: string; body?: any}> = [];
  let otpRequired = false;
  return {
    requests,
    /** Shape of GET /api/business/:businessId — the prefill source for the holder name. */
    business: undefined as unknown,
    requireOtp() {
      otpRequired = true;
    },
    reset() {
      requests.length = 0;
      otpRequired = false;
      this.business = undefined;
    },
    buildContext: async (opts: any) => ({
      env: "sandbox",
      http: {
        baseUrl: "https://api.atoa.me",
        request: async (req: any) => {
          requests.push({method: req.method, path: req.path, body: req.body});
          if (req.path === "/api/business/:businessId/bank/" && req.method === "POST") {
            // The bank surface answers "OTP required" only until a code is supplied.
            if (otpRequired && !(req.body && "otp" in req.body)) {
              const {AtoaError} = await import("../../src/lib/errors");
              throw new AtoaError("OTP required", "validation", {
                status: 401,
                errorCode: "OTP_VERIFICATION_IS_REQUIRED",
                requestId: "r"
              });
            }
            return {status: 200, data: {id: "bank_new", bankName: req.body?.bankName}, requestId: "r"};
          }
          if (req.path === "/api/business/:businessId" && req.method === "GET") {
            return {status: 200, data: mock.business ?? {}, requestId: "r"};
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
import {t} from "../../src/lib/i18n";

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

/**
 * The OTP arrives out of band, so an agent can't be prompted for it — it supplies --otp instead.
 * Without one and with no terminal, the command must say which flag to re-run with rather than
 * failing opaquely: the send has already happened by then, so the user is holding a live code.
 */
describe("bank add — --otp", () => {
  const origStdin = process.stdin.isTTY;
  const origStdout = process.stdout.isTTY;

  beforeEach(() => {
    mock.reset();
    process.exitCode = 0;
    vi.clearAllMocks(); // prompt call counts accumulate across the file otherwise
  });
  afterEach(() => {
    (process.stdin as any).isTTY = origStdin;
    (process.stdout as any).isTTY = origStdout;
  });

  const FIELDS = {
    bankName: "ATOA Test Bank",
    sortCode: "12-34-56",
    accountNumber: "13487215",
    accountHolderName: "Cli Probe"
  };

  // The no-code probe request is what makes the backend SEND a code. Running it when the caller
  // already holds one invalidates that code (random in production) and spends a send against the
  // per-minute allowance — which is how this was caught: the throttle tripped on a live retry.
  it("does not fire the code-sending probe when --otp is supplied", async () => {
    mock.requireOtp();
    (process.stdin as any).isTTY = false;
    (process.stdout as any).isTTY = false;

    await (bankAdd.run as any)({args: {...FIELDS, otp: "340820"}, rawArgs: []});

    const posts = mock.requests.filter((r: any) => r.method === "POST");
    expect(posts).toHaveLength(1); // one request only — the submit, not a probe then a submit
    expect(posts[0].body.otp).toBe("340820");
  });

  it("sends the supplied code on the verify resubmit and never prompts", async () => {
    mock.requireOtp();
    (process.stdin as any).isTTY = false;
    (process.stdout as any).isTTY = false;

    await (bankAdd.run as any)({args: {...FIELDS, otp: "340819"}, rawArgs: []});

    const withCode = mock.requests.filter((r: any) => r.body && "otp" in r.body);
    expect(withCode).toHaveLength(1);
    expect(withCode[0].body.otp).toBe("340819");
    expect(prompts.input).not.toHaveBeenCalled();
  });

  it("names --otp when a code is required and there is no terminal", async () => {
    mock.requireOtp();
    (process.stdin as any).isTTY = false;
    (process.stdout as any).isTTY = false;
    let out = "";
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation((c: any) => ((out += c), true));

    await (bankAdd.run as any)({args: {...FIELDS}, rawArgs: []});
    stderr.mockRestore();

    // 9, not 3: nothing was invalid and no flag was missing — a code was sent and the caller has
    // to come back with it. Exit 3 would tell an agent to go looking for a bad flag; exit 0 would
    // claim the account was added. `atoa signup` reports the same state the same way.
    expect(process.exitCode).toBe(9);
    expect(out).toContain("--otp");
  });
});

describe("bank add — which name is offered as the account holder", () => {
  const origStdin = process.stdin.isTTY;
  const HOLDER_LABEL = t("labelAccountHolderName");
  const PERSON = "Ada Lovelace";
  const COMPANY = "Acme Trading Ltd";

  const businessWith = (companyType?: string) => ({
    user: {firstName: "Ada", lastName: "Lovelace"},
    business: {businessInfo: {legalBusinessName: COMPANY, companyType}}
  });

  /** The default offered at the holder-name prompt, whatever order the prompts ran in. */
  const offeredDefault = () =>
    vi.mocked(prompts.input).mock.calls.find(([o]: any) => o?.message === HOLDER_LABEL)?.[0]?.default;

  beforeEach(() => {
    mock.reset();
    process.exitCode = 0;
    vi.clearAllMocks();
    (process.stdin as any).isTTY = true;
  });

  afterEach(() => {
    (process.stdin as any).isTTY = origStdin;
  });

  // This is not a convenience default — it is the name Confirmation of Payee is matched against,
  // so offering the wrong one invites a mismatch on a real payout account.
  const cases: Array<{companyType?: string; expected: string; because: string}> = [
    {companyType: "COMPANY_LTD", expected: COMPANY, because: "a limited company holds the account in its legal name"},
    {companyType: "SOLE_TRADER", expected: PERSON, because: "a sole trader's account is in their own name"},
    {companyType: "CHARITY", expected: PERSON, because: "a charity is not a limited company"},
    // The one that is easy to "correct" back into a bug: an unset type must not read as a company.
    {companyType: undefined, expected: PERSON, because: "an unset type is not evidence of a company"}
  ];

  for (const {companyType, expected, because} of cases) {
    it(`offers ${expected === COMPANY ? "the legal name" : "the person's name"} when companyType is ${companyType ?? "unset"} — ${because}`, async () => {
      mock.business = businessWith(companyType);

      await (bankAdd.run as any)({
        args: {bankName: "ATOA Test Bank", sortCode: "123456", accountNumber: "12345678", dryRun: true},
        rawArgs: []
      });

      expect(offeredDefault()).toBe(expected);
    });
  }

  it("offers nothing rather than a stray name when the lookup fails", async () => {
    mock.business = {};

    await (bankAdd.run as any)({
      args: {bankName: "ATOA Test Bank", sortCode: "123456", accountNumber: "12345678", dryRun: true},
      rawArgs: []
    });

    expect(offeredDefault()).toBeUndefined();
  });
});
