import {describe, it, expect, vi, beforeEach} from "vitest";

/**
 * atoa signup wizard tests.
 *
 * New flow (full run, --from-step 1, TTY, jwt):
 *   GET  /api/user/profile/                     (identity prefill, best-effort; User model)
 *   POST /api/v1/onboarding/step-1              {firstName, lastName}
 *   GET  /api/merchant/business-types/all       (step-2 lookup)
 *   POST /api/v1/onboarding/step-2              {businessType, name/address}
 *   POST /api/v1/onboarding/step-3              (contact) → 400 OTP_VERIFICATION_IS_REQUIRED
 *   POST /api/v1/onboarding/verify-otp          {otp}
 *   GET  /api/v1/onboarding/transaction-ranges  (step-4 lookup)
 *   POST /api/v1/onboarding/step-4              {acceptTerms:true, ...}   (or .../step-4/skip)
 *
 * Covers:
 *   - Happy path POST sequence + businessId persisted after step-1
 *   - Wrong OTP re-prompts then aborts after 3 attempts
 *   - 429 aborts with rate-limit message
 *   - --skip-extras path (step-4/skip)
 *   - --from-step 3 skips steps 1-2
 *   - Non-TTY errors immediately
 *   - sdk-paste mode errors
 */

const mock = vi.hoisted(() => {
  const requests: Array<{method: string; path: string; auth?: string; body?: any}> = [];
  let printed: unknown = undefined;
  let authMode: "jwt" | "sdk-paste" = "jwt";
  let setBusinessIdCalls: Array<{profileName: string; businessId: string}> = [];
  let activeBusinessId: string | undefined = undefined;

  // Tracks how step-3 + verify-otp behave:
  //   "ok"        → step-3 returns 200 (contact unchanged, no OTP)
  //   "otp"       → step-3 throws 400 OTP_VERIFICATION_IS_REQUIRED, verify-otp succeeds
  //   "badOtp"    → step-3 throws 400 OTP_VERIFICATION_IS_REQUIRED, verify-otp always 400
  //   "rateLimit" → step-3 throws 400 OTP_VERIFICATION_IS_REQUIRED, verify-otp throws 429
  let otpBehaviour: "ok" | "otp" | "badOtp" | "rateLimit" = "otp";

  return {
    requests,
    getPrinted: () => printed,
    setAuthMode(m: "jwt" | "sdk-paste") {
      authMode = m;
    },
    setOtpBehaviour(b: "ok" | "otp" | "badOtp" | "rateLimit") {
      otpBehaviour = b;
    },
    setActiveBusinessId(id: string | undefined) {
      activeBusinessId = id;
    },
    getSetBusinessIdCalls: () => setBusinessIdCalls,
    reset() {
      requests.length = 0;
      printed = undefined;
      authMode = "jwt";
      otpBehaviour = "otp";
      setBusinessIdCalls = [];
      activeBusinessId = undefined;
    },
    getAuthMode: async (_p: string, _e: string) => authMode,
    getActiveBusinessId: async (_p: string) => activeBusinessId,
    setActiveBusinessId_fn: async (profileName: string, businessId: string) => {
      setBusinessIdCalls.push({profileName, businessId});
      activeBusinessId = businessId;
    },
    buildContext: async (opts: any) => ({
      env: "sandbox" as const,
      http: {
        baseUrl: "https://api.atoa.me",
        request: async (req: any) => {
          requests.push({method: req.method, path: req.path, auth: req.auth, body: req.body});

          if (req.path === "/api/user/profile/") {
            // Identity prefill is now the User model.
            return {
              status: 200,
              data: {
                firstName: "Pre",
                lastName: "Fill",
                email: "pre@fill.com",
                phoneCountryCode: "44",
                phoneNumber: "7700900000"
              },
              requestId: "r"
            };
          }
          if (req.path === "/api/merchant/business-types/all") {
            return {status: 200, data: [{id: "bt_1", name: "Retail"}], requestId: "r"};
          }
          if (req.path === "/api/v1/onboarding/transaction-ranges") {
            return {status: 200, data: ["0-1000", "1000-5000"], requestId: "r"};
          }
          if (req.path === "/api/v1/onboarding/step-1") {
            return {status: 200, data: {businessId: "biz_new", nextStep: 2}, requestId: "r"};
          }
          if (req.path === "/api/v1/businesses/:businessId/onboarding/step-2") {
            return {status: 200, data: {nextStep: 3}, requestId: "r"};
          }
          if (req.path === "/api/v1/onboarding/step-3") {
            if (otpBehaviour === "ok") {
              return {status: 200, data: {nextStep: 4}, requestId: "r"};
            }
            const {AtoaError} = await import("../../src/lib/errors");
            throw new AtoaError("OTP required", "validation", {
              status: 400,
              errorCode: "OTP_VERIFICATION_IS_REQUIRED",
              requestId: "r"
            });
          }
          if (req.path === "/api/v1/onboarding/verify-otp") {
            if (otpBehaviour === "rateLimit") {
              const {AtoaError} = await import("../../src/lib/errors");
              throw new AtoaError("Too many requests", "rate_limit", {status: 429, requestId: "r"});
            }
            if (otpBehaviour === "badOtp") {
              const {AtoaError} = await import("../../src/lib/errors");
              throw new AtoaError("Invalid OTP", "validation", {status: 400, requestId: "r"});
            }
            return {status: 200, data: {nextStep: 4}, requestId: "r"};
          }
          if (req.path === "/api/v1/businesses/:businessId/onboarding/step-4") {
            return {status: 200, data: {status: "complete"}, requestId: "r"};
          }
          if (req.path === "/api/v1/businesses/:businessId/onboarding/step-4/skip") {
            return {status: 200, data: {status: "complete"}, requestId: "r"};
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
  return {
    ...actual,
    getAuthMode: mock.getAuthMode,
    getActiveBusinessId: mock.getActiveBusinessId,
    setActiveBusinessId: mock.setActiveBusinessId_fn,
    // ensureSignedUp() resolves an existing session → these short-circuit step-0 so the
    // tests exercise onboarding (not the OTP-signup path, which has its own coverage).
    resolveActiveProfile: async () => ({
      kind: "ok",
      name: "acme",
      profile: {businessId: "biz_1", displayName: "Acme", envs: {production: {tokenFingerprint: "x"}}}
    })
  };
});

// A stored JWT session "exists" → ensureSignedUp is a no-op.
vi.mock("../../src/lib/secrets-store", async () => {
  const actual = await vi.importActual<any>("../../src/lib/secrets-store");
  return {
    ...actual,
    createSecretsStore: async () => ({
      getJwtTokens: async () => ({accessToken: "a", refreshToken: "r"}),
      setJwtTokens: async () => {},
      clearJwtTokens: async () => {}
    })
  };
});

// signup's run calls assertTlsHardenedEnv() directly (buildContext is mocked away).
vi.mock("../../src/lib/http", async () => {
  const actual = await vi.importActual<any>("../../src/lib/http");
  return {...actual, assertTlsHardenedEnv: () => {}};
});

// Mock @inquirer/prompts — must be hoisted so the factory can reference the fns
const promptMocks = vi.hoisted(() => ({
  input: vi.fn(),
  confirm: vi.fn(),
  select: vi.fn()
}));
vi.mock("@inquirer/prompts", () => ({
  input: promptMocks.input,
  confirm: promptMocks.confirm,
  select: promptMocks.select
}));

import signup from "../../src/commands/signup";

/** The POST onboarding endpoints, in the order a full run hits them. */
function postPaths() {
  return mock.requests.filter((r) => r.method === "POST").map((r) => r.path);
}

/** Wire up the full-run prompt answers (step1 → step4). */
function fullRunPrompts() {
  promptMocks.input.mockReset();
  promptMocks.input
    .mockResolvedValueOnce("John") // step1 firstName
    .mockResolvedValueOnce("Doe") // step1 lastName
    .mockResolvedValueOnce("Acme Ltd") // step2 legalBusinessName
    .mockResolvedValueOnce("12345678") // step2 CRN / charity number
    .mockResolvedValueOnce("Acme") // step2 tradingName
    .mockResolvedValueOnce("1 High St") // step2 addressLine1
    .mockResolvedValueOnce("") // step2 addressLine2
    .mockResolvedValueOnce("London") // step2 cityOrTown
    .mockResolvedValueOnce("EC1A 1BB") // step2 addressPostalCode
    .mockResolvedValueOnce("john@acme.com") // step3 email
    .mockResolvedValueOnce("44") // step3 phoneCountryCode
    .mockResolvedValueOnce("7700900001") // step3 phoneNumber
    .mockResolvedValueOnce("123456") // OTP attempt 1
    .mockResolvedValue("Twitter"); // step4 sourceOfInstall (+ any extra)

  promptMocks.select.mockReset();
  promptMocks.select
    .mockResolvedValueOnce("bt_1") // step2 businessType (industry)
    .mockResolvedValueOnce("COMPANY_LTD") // step2 business structure
    .mockResolvedValueOnce("0-1000"); // step4 transaction range

  promptMocks.confirm.mockReset();
  promptMocks.confirm.mockResolvedValue(true); // T&C
}

beforeEach(() => {
  mock.reset();
  process.exitCode = 0;
  (process.stdin as any).isTTY = true;
  fullRunPrompts();
});

describe("signup — happy path (full wizard)", () => {
  it("POSTs the onboarding steps in the correct order", async () => {
    await (signup.run as any)({args: {}, rawArgs: []});

    expect(postPaths()).toEqual([
      "/api/v1/onboarding/step-1",
      "/api/v1/businesses/:businessId/onboarding/step-2",
      "/api/v1/onboarding/step-3",
      "/api/v1/onboarding/verify-otp",
      "/api/v1/businesses/:businessId/onboarding/step-4"
    ]);
  });

  it("prefills via GET /api/user/profile/ and looks up business-types + transaction-ranges", async () => {
    await (signup.run as any)({args: {}, rawArgs: []});
    const gets = mock.requests.filter((r) => r.method === "GET").map((r) => r.path);
    expect(gets).toContain("/api/user/profile/");
    expect(gets).toContain("/api/merchant/business-types/all");
    expect(gets).toContain("/api/v1/onboarding/transaction-ranges");
  });

  it("sends the selected businessType in the step-2 body", async () => {
    await (signup.run as any)({args: {}, rawArgs: []});
    const step2 = mock.requests.find((r) => r.path === "/api/v1/businesses/:businessId/onboarding/step-2");
    expect(step2?.body?.businessType).toEqual({id: "bt_1", name: "Retail"});
  });

  it("sends companyType (legal structure) and crn in the step-2 body", async () => {
    await (signup.run as any)({args: {}, rawArgs: []});
    const step2 = mock.requests.find((r) => r.path === "/api/v1/businesses/:businessId/onboarding/step-2");
    expect(step2?.body?.companyType).toBe("COMPANY_LTD");
    expect(step2?.body?.crn).toBe("12345678");
  });

  it("sends acceptTerms and the chosen transaction range in the step-4 body", async () => {
    await (signup.run as any)({args: {}, rawArgs: []});
    const step4 = mock.requests.find((r) => r.path === "/api/v1/businesses/:businessId/onboarding/step-4");
    expect(step4?.body).toMatchObject({acceptTerms: true, averageMonthlyTransaction: "0-1000"});
  });

  it("persists businessId after step-1 before continuing", async () => {
    await (signup.run as any)({args: {}, rawArgs: []});

    const calls = mock.getSetBusinessIdCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({profileName: "acme", businessId: "biz_new"});

    const step1Idx = mock.requests.findIndex((r) => r.path === "/api/v1/onboarding/step-1");
    const step2Idx = mock.requests.findIndex((r) => r.path === "/api/v1/businesses/:businessId/onboarding/step-2");
    expect(step1Idx).toBeLessThan(step2Idx);
  });

  it("sends OTP in verify-otp body", async () => {
    await (signup.run as any)({args: {}, rawArgs: []});

    const otpReq = mock.requests.find((r) => r.path === "/api/v1/onboarding/verify-otp");
    expect(otpReq?.body?.otp).toBe("123456");
  });

  it("skips OTP when step-3 succeeds (unchanged contact)", async () => {
    mock.setOtpBehaviour("ok");
    await (signup.run as any)({args: {}, rawArgs: []});

    const paths = mock.requests.map((r) => r.path);
    expect(paths).toContain("/api/v1/onboarding/step-3");
    expect(paths).not.toContain("/api/v1/onboarding/verify-otp");
  });

  it("prints a completion summary", async () => {
    await (signup.run as any)({args: {}, rawArgs: []});
    const printed = mock.getPrinted() as any;
    expect(printed).toMatchObject({status: "complete"});
  });
});

describe("signup — --skip-extras", () => {
  it("calls step-4/skip and skips step-4 (no transaction-ranges lookup)", async () => {
    await (signup.run as any)({args: {skipExtras: true}, rawArgs: []});

    const paths = mock.requests.map((r) => r.path);
    expect(paths).toContain("/api/v1/businesses/:businessId/onboarding/step-4/skip");
    expect(paths).not.toContain("/api/v1/businesses/:businessId/onboarding/step-4");
    expect(paths).not.toContain("/api/v1/onboarding/transaction-ranges");
  });
});

describe("signup — --from-step 3", () => {
  beforeEach(() => {
    mock.setActiveBusinessId("biz_existing");

    promptMocks.input.mockReset();
    promptMocks.input
      .mockResolvedValueOnce("john@acme.com") // email
      .mockResolvedValueOnce("44") // phoneCountryCode
      .mockResolvedValueOnce("7700900001") // phoneNumber
      .mockResolvedValueOnce("654321") // OTP
      .mockResolvedValue("Twitter"); // step4 sourceOfInstall

    promptMocks.select.mockReset();
    promptMocks.select.mockResolvedValue("0-1000"); // transaction range
    promptMocks.confirm.mockReset();
    promptMocks.confirm.mockResolvedValue(true); // T&C
  });

  it("skips step-1 and step-2 requests", async () => {
    await (signup.run as any)({args: {fromStep: "3"}, rawArgs: []});

    const paths = mock.requests.map((r) => r.path);
    expect(paths).not.toContain("/api/v1/onboarding/step-1");
    expect(paths).not.toContain("/api/v1/businesses/:businessId/onboarding/step-2");
    expect(paths).toContain("/api/v1/onboarding/step-3");
    expect(paths).toContain("/api/v1/onboarding/verify-otp");
  });

  it("errors when --from-step >= 2 and no activeBusinessId", async () => {
    mock.setActiveBusinessId(undefined);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (signup.run as any)({args: {fromStep: "3"}, rawArgs: []});
    expect(process.exitCode).toBe(3);
    const errOut = stderr.mock.calls.map((c) => String(c[0])).join("");
    expect(errOut).toMatch(/business/i);
    stderr.mockRestore();
  });
});

describe("signup — wrong OTP re-prompts then aborts", () => {
  beforeEach(() => {
    mock.setOtpBehaviour("badOtp");
    fullRunPrompts();
    // Override OTP answers: 3 wrong attempts
    promptMocks.input.mockReset();
    promptMocks.input
      .mockResolvedValueOnce("John")
      .mockResolvedValueOnce("Doe")
      .mockResolvedValueOnce("Acme Ltd")
      .mockResolvedValueOnce("Acme")
      .mockResolvedValueOnce("1 High St")
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("London")
      .mockResolvedValueOnce("EC1A 1BB")
      .mockResolvedValueOnce("john@acme.com")
      .mockResolvedValueOnce("44")
      .mockResolvedValueOnce("7700900001")
      .mockResolvedValueOnce("wrong1") // OTP attempt 1
      .mockResolvedValueOnce("wrong2") // OTP attempt 2
      .mockResolvedValueOnce("wrong3"); // OTP attempt 3
    promptMocks.select.mockReset();
    promptMocks.select.mockResolvedValueOnce("bt_1");
    promptMocks.confirm.mockReset();
    promptMocks.confirm.mockResolvedValue(true);
  });

  it("re-prompts up to 3 times then exits with validation error", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (signup.run as any)({args: {}, rawArgs: []});

    expect(process.exitCode).toBe(3);

    const otpRequests = mock.requests.filter((r) => r.path === "/api/v1/onboarding/verify-otp");
    expect(otpRequests).toHaveLength(3);

    const errOut = stderr.mock.calls.map((c) => String(c[0])).join("");
    expect(errOut).toMatch(/[Oo]TP|attempt/i);

    stderr.mockRestore();
  });
});

describe("signup — 429 rate limit aborts with message", () => {
  beforeEach(() => {
    mock.setOtpBehaviour("rateLimit");
    fullRunPrompts();
  });

  it("aborts with rate-limit exit code (5) and a clear message", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (signup.run as any)({args: {}, rawArgs: []});

    expect(process.exitCode).toBe(5);
    const errOut = stderr.mock.calls.map((c) => String(c[0])).join("");
    expect(errOut).toMatch(/rate limit|wait/i);

    stderr.mockRestore();
  });
});

describe("signup — non-TTY", () => {
  it("errors immediately in non-TTY mode", async () => {
    (process.stdin as any).isTTY = false;
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (signup.run as any)({args: {}, rawArgs: []});
    expect(process.exitCode).toBe(3);
    expect(mock.requests).toHaveLength(0);
    stderr.mockRestore();
    (process.stdin as any).isTTY = true;
  });
});
