import {describe, it, expect, vi, beforeEach} from "vitest";

/**
 * atoa signup wizard tests — mirrors the dashboard /registration flow (no /v1 facade).
 *
 * Full run (--from-step 1, TTY, jwt) HTTP sequence:
 *   GET  /api/user/profile/                                              (prefill, best-effort)
 *   Step 1 — business details:
 *     GET  /api/merchant/business-types/all                             (industry lookup)
 *     POST /api/business/                                               (createBusiness → {business:{id}})
 *     PUT  /api/business/:businessId/accept-terms
 *     PUT  /api/user/profile/notification-options                       {allowMarketingEmails}
 *     PUT  /api/business/:businessId/communication-preferences/marketing-consent {enabled}
 *   Step 2 — structure:
 *     PUT  /api/business/:businessId                                    {businessInfo:{companyType}}
 *   Step 3 — personal:
 *     PUT  /api/user/profile                                            {firstName,lastName}
 *     PUT  /api/user/profile/contact (×2 when OTP)                      {phone...}/{...,otp}
 *     PUT  /api/business/:businessId                                    {businessInfo:{address...}}
 *   Step 4 — extras:
 *     GET  /api/merchant/average-transaction/ranges
 *     GET  /api/signup-source/all
 *     PUT  /api/business/:businessId                                    {businessInfo:{avg...}, sourceOfInstall}
 */

const mock = vi.hoisted(() => {
  const requests: Array<{method: string; path: string; auth?: string; body?: any}> = [];
  let printed: unknown = undefined;
  let setBusinessIdCalls: Array<{profileName: string; businessId: string}> = [];
  let activeBusinessId: string | undefined = undefined;

  // contact (PUT /user/profile/contact) OTP behaviour:
  //   "ok"        → first attempt 200 (no OTP)
  //   "otp"       → first attempt 400 OTP_VERIFICATION_IS_REQUIRED, OTP resubmit succeeds
  //   "badOtp"    → first 400 OTP_REQUIRED, every OTP resubmit 400
  //   "rateLimit" → first 400 OTP_REQUIRED, OTP resubmit 429
  let otpBehaviour: "ok" | "otp" | "badOtp" | "rateLimit" = "otp";
  // Whether a JWT session already exists → toggles the email-OTP account-creation path (otpSignup).
  let sessionExists = true;

  return {
    requests,
    getPrinted: () => printed,
    setOtpBehaviour(b: "ok" | "otp" | "badOtp" | "rateLimit") {
      otpBehaviour = b;
    },
    setSessionExists(b: boolean) {
      sessionExists = b;
    },
    sessionActive: () => sessionExists,
    setActiveBusinessId(id: string | undefined) {
      activeBusinessId = id;
    },
    getSetBusinessIdCalls: () => setBusinessIdCalls,
    reset() {
      requests.length = 0;
      printed = undefined;
      otpBehaviour = "otp";
      sessionExists = true;
      setBusinessIdCalls = [];
      activeBusinessId = undefined;
    },
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
          const {AtoaError} = await import("../../src/lib/errors");

          if (req.path === "/api/user/profile/" && req.method === "GET") {
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
          if (req.path === "/api/merchant/average-transaction/ranges") {
            return {status: 200, data: ["0-1000", "1000-5000"], requestId: "r"};
          }
          if (req.path === "/api/signup-source/all") {
            return {status: 200, data: [{id: "s_1", description: "Twitter"}], requestId: "r"};
          }
          if (req.path === "/api/business/:businessId" && req.method === "GET") {
            // Resume seed (--from-step >= 2).
            return {
              status: 200,
              data: {
                business: {
                  businessInfo: {
                    legalBusinessName: "Existing Ltd",
                    tradingName: "Existing",
                    businessType: {id: "bt_1", name: "Retail"}
                  }
                }
              },
              requestId: "r"
            };
          }
          if (req.path === "/api/business/" && req.method === "POST") {
            return {status: 200, data: {business: {id: "biz_new"}}, requestId: "r"};
          }
          if (req.path === "/api/user/profile/contact" && req.method === "PUT") {
            const hasOtp = req.body && "otp" in req.body;
            if (!hasOtp) {
              if (otpBehaviour === "ok") return {status: 200, data: {}, requestId: "r"};
              throw new AtoaError("OTP required", "validation", {
                status: 400,
                errorCode: "OTP_VERIFICATION_IS_REQUIRED",
                requestId: "r"
              });
            }
            if (otpBehaviour === "rateLimit")
              throw new AtoaError("Too many requests", "rate_limit", {status: 429, requestId: "r"});
            if (otpBehaviour === "badOtp")
              throw new AtoaError("Invalid OTP", "validation", {status: 400, requestId: "r"});
            return {status: 200, data: {}, requestId: "r"};
          }
          // accept-terms, notification-options, marketing-consent, updateProfile, updateBusiness (steps 2-4)
          return {status: 200, data: {}, requestId: "r"};
        }
      },
      format: "json",
      formatExplicit: true, // deterministic machine-output branch → ctx.print() (not the TTY summary)
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

// Controllable HTTP client for the EMAIL-OTP account-creation path. otpSignup builds its own
// client via buildHttpClient (separate from the mocked buildContext), so this drives otp/send,
// otp/verify-otp and sign-up without real network.
const emailHttp = vi.hoisted(() => {
  const requests: Array<{method: string; path: string; body?: any}> = [];
  let verifyStatus = 0; // 0 = verify succeeds; otherwise throw an AtoaError with this status
  return {
    requests,
    setVerifyStatus(s: number) {
      verifyStatus = s;
    },
    reset() {
      requests.length = 0;
      verifyStatus = 0;
    },
    client: {
      baseUrl: "https://api.atoa.me",
      request: async (req: any) => {
        requests.push({method: req.method, path: req.path, body: req.body});
        const {AtoaError} = await import("../../src/lib/errors");
        if (req.path === "/api/otp/verify-otp" && verifyStatus) {
          // Mimic the backend's raw error — its looser "attempts remaining" counter is exactly
          // what must NOT leak to the user on the final attempt.
          throw new AtoaError("Incorrect code used. 2 attempts remaining", "generic", {
            status: verifyStatus,
            requestId: "otp-req"
          });
        }
        if (req.path === "/api/otp/verify-otp") return {status: 200, data: {otpVerifiedToken: "tok"}, requestId: "r"};
        if (req.path === "/api/user/auth/sign-up")
          return {status: 200, data: {accessToken: "at", refreshToken: "rt"}, requestId: "r"};
        return {status: 200, data: {}, requestId: "r"}; // otp/send + anything else
      }
    }
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
    setActiveBusinessId: mock.setActiveBusinessId_fn,
    // Profile rename touches the real ~/.atoa store; no-op it so the wizard reaches the summary.
    renameProfile: async () => {},
    // ensureSignedUp() resolves an existing session → these short-circuit step-0.
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
      // sessionActive() === false simulates a brand-new user → ensureSignedUp runs otpSignup.
      getJwtTokens: async () => (mock.sessionActive() ? {accessToken: "a", refreshToken: "r"} : null),
      setJwtTokens: async () => {},
      clearJwtTokens: async () => {}
    })
  };
});

vi.mock("../../src/lib/http", async () => {
  const actual = await vi.importActual<any>("../../src/lib/http");
  // buildHttpClient is used directly only by otpSignup (email-OTP path); buildContext is mocked
  // separately with its own http, so this override is scoped to account creation.
  return {...actual, assertTlsHardenedEnv: () => {}, buildHttpClient: () => emailHttp.client};
});

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

const paths = () => mock.requests.map((r) => r.path);
const byPath = (p: string) => mock.requests.filter((r) => r.path === p);

/** Full-run prompt answers (from step 1, with phone → OTP). */
function fullRunPrompts() {
  promptMocks.input.mockReset();
  promptMocks.input
    .mockResolvedValueOnce("Acme Ltd") // step1 business name
    .mockResolvedValueOnce("John") // step3 firstName
    .mockResolvedValueOnce("Doe") // step3 lastName
    .mockResolvedValueOnce("44") // step3 phoneCountryCode
    .mockResolvedValueOnce("7700900001") // step3 phoneNumber
    .mockResolvedValueOnce("123456") // step3 OTP (withOtp)
    .mockResolvedValueOnce("1 High St") // step3 business address
    .mockResolvedValue("EC1A 1BB"); // step3 postcode (+ any extra)

  promptMocks.select.mockReset();
  promptMocks.select
    .mockResolvedValueOnce("bt_1") // step1 industry
    .mockResolvedValueOnce("COMPANY_LTD") // step2 structure
    .mockResolvedValueOnce("0-1000") // step4 turnover
    .mockResolvedValue("Twitter"); // step4 source

  promptMocks.confirm.mockReset();
  promptMocks.confirm.mockResolvedValue(true); // privacy, terms, marketing
}

beforeEach(() => {
  mock.reset();
  emailHttp.reset();
  process.exitCode = 0;
  (process.stdin as any).isTTY = true;
  fullRunPrompts();
});

describe("signup — happy path (full wizard)", () => {
  it("hits the onboarding endpoints in the correct order", async () => {
    await (signup.run as any)({args: {}, rawArgs: []});

    expect(paths()).toEqual([
      "/api/user/profile/", // prefill
      "/api/merchant/business-types/all", // step1 industry
      "/api/business/", // step1 createBusiness
      "/api/business/:businessId/accept-terms", // step1 consent
      "/api/user/profile/notification-options", // step1 marketing (user)
      "/api/business/:businessId/communication-preferences/marketing-consent", // step1 marketing (business)
      "/api/business/:businessId", // step2 structure
      "/api/user/profile", // step3 name
      "/api/user/profile/contact", // step3 phone (OTP send)
      "/api/user/profile/contact", // step3 phone (OTP verify)
      "/api/business/:businessId", // step3 address
      "/api/merchant/average-transaction/ranges", // step4 lookup
      "/api/signup-source/all", // step4 lookup
      "/api/business/:businessId" // step4 extras
    ]);
  });

  it("creates the business with the chosen name + industry (flat body)", async () => {
    await (signup.run as any)({args: {}, rawArgs: []});
    const create = byPath("/api/business/").find((r) => r.method === "POST");
    expect(create?.body).toMatchObject({
      legalBusinessName: "Acme Ltd",
      tradingName: "Acme Ltd",
      businessType: {id: "bt_1", name: "Retail"}
    });
  });

  it("records consent: accept-terms + marketing (user + business)", async () => {
    await (signup.run as any)({args: {}, rawArgs: []});
    expect(byPath("/api/business/:businessId/accept-terms")).toHaveLength(1);
    expect(byPath("/api/user/profile/notification-options")[0]?.body).toEqual({allowMarketingEmails: true});
    expect(byPath("/api/business/:businessId/communication-preferences/marketing-consent")[0]?.body).toEqual({
      enabled: true
    });
  });

  it("sends companyType nested under businessInfo in step 2", async () => {
    await (signup.run as any)({args: {}, rawArgs: []});
    const updates = byPath("/api/business/:businessId").filter((r) => r.method === "PUT");
    const step2 = updates.find((r) => r.body?.businessInfo?.companyType);
    expect(step2?.body?.businessInfo).toMatchObject({
      companyType: "COMPANY_LTD",
      legalBusinessName: "Acme Ltd",
      businessType: {id: "bt_1"}
    });
  });

  it("sends name to /user/profile and address (nested) in step 3", async () => {
    await (signup.run as any)({args: {}, rawArgs: []});
    expect(byPath("/api/user/profile").find((r) => r.method === "PUT")?.body).toEqual({
      firstName: "John",
      lastName: "Doe"
    });
    const addr = byPath("/api/business/:businessId").find((r) => r.body?.businessInfo?.addressLine1);
    expect(addr?.body?.businessInfo).toMatchObject({addressLine1: "1 High St", addressPostalCode: "EC1A 1BB"});
  });

  it("sends turnover + sourceOfInstall in step 4 (full businessInfo resent)", async () => {
    await (signup.run as any)({args: {}, rawArgs: []});
    const extras = byPath("/api/business/:businessId").find((r) => r.body?.sourceOfInstall);
    expect(extras?.body?.sourceOfInstall).toBe("Twitter");
    expect(extras?.body?.businessInfo).toMatchObject({
      averageMonthlyTransaction: "0-1000",
      companyType: "COMPANY_LTD",
      legalBusinessName: "Acme Ltd"
    });
  });

  it("persists businessId immediately after createBusiness", async () => {
    await (signup.run as any)({args: {}, rawArgs: []});
    const calls = mock.getSetBusinessIdCalls();
    expect(calls).toEqual([{profileName: "acme", businessId: "biz_new"}]);

    const createIdx = mock.requests.findIndex((r) => r.path === "/api/business/" && r.method === "POST");
    const step2Idx = mock.requests.findIndex((r) => r.path === "/api/business/:businessId" && r.method === "PUT");
    expect(createIdx).toBeLessThan(step2Idx);
  });

  it("sends the OTP on the contact verify resubmit", async () => {
    await (signup.run as any)({args: {}, rawArgs: []});
    const contact = byPath("/api/user/profile/contact");
    expect(contact).toHaveLength(2);
    expect(contact[1]?.body?.otp).toBe("123456");
  });

  it("skips OTP when the contact update succeeds outright", async () => {
    mock.setOtpBehaviour("ok");
    await (signup.run as any)({args: {}, rawArgs: []});
    expect(byPath("/api/user/profile/contact")).toHaveLength(1);
  });

  it("prints a completion summary", async () => {
    await (signup.run as any)({args: {}, rawArgs: []});
    expect(mock.getPrinted()).toMatchObject({status: "complete"});
  });
});

describe("signup — --skip-extras", () => {
  it("skips the step-4 lookups and the extras update", async () => {
    await (signup.run as any)({args: {skipExtras: true}, rawArgs: []});
    expect(paths()).not.toContain("/api/merchant/average-transaction/ranges");
    expect(paths()).not.toContain("/api/signup-source/all");
    // step-4 extras PUT (the one carrying sourceOfInstall) must not happen.
    expect(byPath("/api/business/:businessId").some((r) => r.body?.sourceOfInstall)).toBe(false);
  });
});

describe("signup — --from-step 3", () => {
  beforeEach(() => {
    mock.setActiveBusinessId("biz_existing");
    promptMocks.input.mockReset();
    promptMocks.input
      .mockResolvedValueOnce("John") // firstName
      .mockResolvedValueOnce("Doe") // lastName
      .mockResolvedValueOnce("44") // phoneCountryCode
      .mockResolvedValueOnce("7700900001") // phoneNumber
      .mockResolvedValueOnce("654321") // OTP
      .mockResolvedValueOnce("1 High St") // business address
      .mockResolvedValue("EC1A 1BB"); // postcode
    promptMocks.select.mockReset();
    promptMocks.select.mockResolvedValueOnce("0-1000").mockResolvedValue("Twitter");
    promptMocks.confirm.mockReset();
    promptMocks.confirm.mockResolvedValue(true);
  });

  it("seeds from GET business, skips create + structure, runs personal + extras", async () => {
    await (signup.run as any)({args: {fromStep: "3"}, rawArgs: []});
    const p = paths();
    expect(p).toContain("/api/business/:businessId"); // GET seed + PUTs
    expect(mock.requests.some((r) => r.path === "/api/business/" && r.method === "POST")).toBe(false); // no create
    expect(p).toContain("/api/user/profile"); // step3 name
    expect(p).toContain("/api/user/profile/contact"); // step3 phone
    // address PUT carries the seeded businessType (so the backend replace keeps it)
    const addr = byPath("/api/business/:businessId").find(
      (r) => r.method === "PUT" && r.body?.businessInfo?.addressLine1
    );
    expect(addr?.body?.businessInfo?.businessType).toEqual({id: "bt_1", name: "Retail"});
  });

  it("errors when --from-step >= 2 and no activeBusinessId", async () => {
    mock.setActiveBusinessId(undefined);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (signup.run as any)({args: {fromStep: "3"}, rawArgs: []});
    expect(process.exitCode).toBe(3);
    expect(stderr.mock.calls.map((c) => String(c[0])).join("")).toMatch(/business/i);
    stderr.mockRestore();
  });
});

describe("signup — wrong OTP re-prompts then aborts", () => {
  beforeEach(() => {
    mock.setOtpBehaviour("badOtp");
    promptMocks.input.mockReset();
    promptMocks.input
      .mockResolvedValueOnce("Acme Ltd") // step1 name
      .mockResolvedValueOnce("John") // firstName
      .mockResolvedValueOnce("Doe") // lastName
      .mockResolvedValueOnce("44") // phoneCountryCode
      .mockResolvedValueOnce("7700900001") // phoneNumber
      .mockResolvedValueOnce("wrong1") // OTP attempt 1
      .mockResolvedValueOnce("wrong2") // OTP attempt 2
      .mockResolvedValue("wrong3"); // OTP attempt 3
    promptMocks.select.mockReset();
    promptMocks.select.mockResolvedValueOnce("bt_1").mockResolvedValue("COMPANY_LTD");
    promptMocks.confirm.mockReset();
    promptMocks.confirm.mockResolvedValue(true);
  });

  it("re-prompts up to 5 times then exits with validation error", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (signup.run as any)({args: {}, rawArgs: []});
    expect(process.exitCode).toBe(3);
    // contact: 1 send + 5 OTP attempts = 6 calls.
    expect(byPath("/api/user/profile/contact")).toHaveLength(6);
    expect(stderr.mock.calls.map((c) => String(c[0])).join("")).toMatch(/[Oo]TP|attempt/i);
    stderr.mockRestore();
  });
});

describe("signup — 429 rate limit aborts with message", () => {
  beforeEach(() => {
    mock.setOtpBehaviour("rateLimit");
  });

  it("aborts with rate-limit exit code (5) and a clear message", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (signup.run as any)({args: {}, rawArgs: []});
    expect(process.exitCode).toBe(5);
    expect(stderr.mock.calls.map((c) => String(c[0])).join("")).toMatch(/rate limit|wait/i);
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

describe("signup — email OTP exhausted (account creation)", () => {
  beforeEach(() => {
    mock.setSessionExists(false); // brand-new user → otpSignup runs the email-OTP loop
    emailHttp.setVerifyStatus(400); // backend rejects every code
    promptMocks.input.mockReset();
    promptMocks.input
      .mockResolvedValueOnce("new@user.com") // email
      .mockResolvedValueOnce("111111") // OTP attempt 1
      .mockResolvedValueOnce("222222") // OTP attempt 2
      .mockResolvedValue("333333"); // OTP attempt 3
  });

  it("after 5 wrong codes shows a clean exhaustion message, not the raw backend error", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (signup.run as any)({args: {}, rawArgs: []});
    // the backend's per-attempt message legitimately shows while retries remain, but the final
    // exhaustion block (printError's single write call) is our own clean, actionable message —
    // not the contradictory backend text.
    const finalBlock = String(stderr.mock.calls[stderr.mock.calls.length - 1][0]);
    stderr.mockRestore();

    expect(process.exitCode).toBe(3); // validation exit code
    // exactly MAX (5) verify attempts — capped by us, not the backend's looser counter
    expect(emailHttp.requests.filter((r) => r.path === "/api/otp/verify-otp")).toHaveLength(5);
    expect(finalBlock).toMatch(/Too many incorrect OTP attempts/i);
    expect(finalBlock).not.toMatch(/Incorrect code used/i);
    // aborted before creating the account
    expect(emailHttp.requests.some((r) => r.path === "/api/user/auth/sign-up")).toBe(false);
  });
});
