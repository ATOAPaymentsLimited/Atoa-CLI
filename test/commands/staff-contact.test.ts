import {describe, it, expect, vi, beforeEach, afterEach} from "vitest";

/**
 * A staff member may have an email, a phone, or both — hasContact() requires at least one, not
 * exactly one. The interactive prompt used to return as soon as an email was typed, so anyone
 * wanting both had to abandon the wizard and re-run with flags. These pin both halves of the rule.
 */
vi.mock("@inquirer/prompts", () => ({
  input: vi.fn(async () => ""),
  select: vi.fn(async () => "role_1"),
  checkbox: vi.fn(async () => [])
}));

const mock = vi.hoisted(() => {
  const requests: Array<{method: string; path: string; body?: any}> = [];
  return {
    requests,
    formatExplicit: false,
    reset() {
      requests.length = 0;
      this.formatExplicit = false;
    },
    buildContext: async (opts: any) => ({
      env: "sandbox",
      http: {
        baseUrl: "https://api.atoa.me",
        request: async (req: any) => {
          requests.push({method: req.method, path: req.path, body: req.body});
          if (req.path === "/api/business/:businessId/roles" || req.path?.includes("role")) {
            return {status: 200, data: [{id: "role_1", name: "Manager"}], requestId: "r"};
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
      print: () => {}
    })
  };
});

vi.mock("../../src/lib/context", async () => {
  const actual = await vi.importActual<any>("../../src/lib/context");
  return {...actual, buildContext: mock.buildContext};
});

import staffAdd from "../../src/commands/staff/add";
import * as prompts from "@inquirer/prompts";

const postBody = () => mock.requests.find((r) => r.method === "POST")?.body;

describe("staff add — contact details", () => {
  const origStdin = process.stdin.isTTY;
  const origStdout = process.stdout.isTTY;

  beforeEach(() => {
    mock.reset();
    process.exitCode = 0;
    vi.clearAllMocks();
    (process.stdin as any).isTTY = true;
    (process.stdout as any).isTTY = true;
  });

  afterEach(() => {
    (process.stdin as any).isTTY = origStdin;
    (process.stdout as any).isTTY = origStdout;
  });

  it("keeps asking for a phone after an email, so both can be given", async () => {
    vi.mocked(prompts.input)
      .mockResolvedValueOnce("ada@example.com") // email
      .mockResolvedValueOnce("7700900123") // phone number
      .mockResolvedValueOnce("44"); // country code

    await (staffAdd.run as any)({
      args: {firstName: "Ada", lastName: "Lovelace", role: "role_1"},
      rawArgs: []
    });

    expect(postBody()).toMatchObject({
      email: "ada@example.com",
      phoneNumber: "7700900123",
      phoneCountryCode: "44"
    });
  });

  it("accepts an email alone, and does not invent a phone", async () => {
    vi.mocked(prompts.input)
      .mockResolvedValueOnce("ada@example.com") // email
      .mockResolvedValueOnce(""); // phone left blank

    await (staffAdd.run as any)({
      args: {firstName: "Ada", lastName: "Lovelace", role: "role_1"},
      rawArgs: []
    });

    const body = postBody();
    expect(body).toMatchObject({email: "ada@example.com"});
    expect(body).not.toHaveProperty("phoneNumber");
  });

  it("accepts a phone alone", async () => {
    vi.mocked(prompts.input)
      .mockResolvedValueOnce("") // email blank
      .mockResolvedValueOnce("7700900123") // phone number
      .mockResolvedValueOnce("44"); // country code

    await (staffAdd.run as any)({
      args: {firstName: "Ada", lastName: "Lovelace", role: "role_1"},
      rawArgs: []
    });

    const body = postBody();
    expect(body).toMatchObject({phoneNumber: "7700900123", phoneCountryCode: "44"});
    expect(body).not.toHaveProperty("email");
  });

  it("refuses when both are left blank, without creating anything", async () => {
    vi.mocked(prompts.input).mockResolvedValue("");
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await (staffAdd.run as any)({
      args: {firstName: "Ada", lastName: "Lovelace", role: "role_1"},
      rawArgs: []
    });
    stderr.mockRestore();

    expect(process.exitCode).toBe(3);
    expect(mock.requests.some((r) => r.method === "POST")).toBe(false);
  });

  it("takes both from flags too, with no prompting", async () => {
    mock.formatExplicit = true; // --output json

    await (staffAdd.run as any)({
      args: {
        firstName: "Ada",
        lastName: "Lovelace",
        role: "role_1",
        email: "ada@example.com",
        phoneCountryCode: "44",
        phone: "7700900123"
      },
      rawArgs: []
    });

    expect(prompts.input).not.toHaveBeenCalled();
    expect(postBody()).toMatchObject({
      email: "ada@example.com",
      phoneNumber: "7700900123",
      phoneCountryCode: "44"
    });
  });
});
