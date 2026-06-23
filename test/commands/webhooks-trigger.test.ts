import {describe, it, expect, beforeEach, vi} from "vitest";

const mock = vi.hoisted(() => {
  const requests: Array<{method: string; path: string; body?: any}> = [];
  return {
    requests,
    reset() {
      requests.length = 0;
    },
    buildContext: async (opts: any) => ({
      env: "sandbox" as const,
      http: {
        baseUrl: "https://api.example.test",
        request: async (req: any) => {
          requests.push({method: req.method, path: req.path, body: req.body});
          return {status: 200, data: {message: "Test webhook triggered successfully."}, requestId: "r"};
        }
      },
      format: "json",
      verbose: false,
      dryRun: opts.dryRun ?? false,
      yes: opts.yes ?? true,
      authFingerprint: "abcd",
      profileName: "vignesh",
      profile: {businessId: "biz_1", displayName: "VIGNESH", envs: {sandbox: {tokenFingerprint: "x"}}},
      print: () => {}
    })
  };
});

vi.mock("../../src/lib/context", async () => {
  const actual = await vi.importActual<any>("../../src/lib/context");
  return {...actual, buildSdkContext: mock.buildContext};
});

import trigger from "../../src/commands/webhooks/trigger";

beforeEach(() => {
  mock.reset();
  process.exitCode = 0;
});

describe("webhooks trigger — event validation", () => {
  it("rejects unknown event types", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (trigger.run as any)({args: {event: "GARBAGE_EVENT"}, rawArgs: ["GARBAGE_EVENT"]});
    expect(process.exitCode).toBe(3); // validation
    expect(mock.requests).toHaveLength(0);
    stderr.mockRestore();
  });

  it("accepts PAYMENTS_STATUS / REFUND_STATUS / EXPIRED_STATUS / POS_PAYMENT_STATUS", async () => {
    for (const event of ["PAYMENTS_STATUS", "REFUND_STATUS", "EXPIRED_STATUS", "POS_PAYMENT_STATUS"]) {
      mock.reset();
      await (trigger.run as any)({args: {event, yes: true}, rawArgs: [event]});
      expect(mock.requests).toHaveLength(1);
      expect(mock.requests[0].body.eventType).toBe(event);
    }
  });

  it("POSTs to /api/webhook/test", async () => {
    await (trigger.run as any)({args: {event: "PAYMENTS_STATUS"}, rawArgs: ["PAYMENTS_STATUS"]});
    expect(mock.requests[0].method).toBe("POST");
    expect(mock.requests[0].path).toBe("/api/webhook/test");
  });
});

describe("webhooks trigger — sandbox-only enforcement", () => {
  it("notifies (via stderr) when user passes --env production", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (trigger.run as any)({args: {event: "PAYMENTS_STATUS", env: "production"}, rawArgs: ["PAYMENTS_STATUS"]});
    const err = stderr.mock.calls.map((c) => String(c[0])).join("");
    expect(err).toMatch(/note: --env=production ignored/);
    // BUT the request still goes through with sandbox auth
    expect(mock.requests).toHaveLength(1);
    stderr.mockRestore();
  });

  it("does NOT warn when user passes --env sandbox (the default)", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (trigger.run as any)({args: {event: "PAYMENTS_STATUS", env: "sandbox"}, rawArgs: ["PAYMENTS_STATUS"]});
    const err = stderr.mock.calls.map((c) => String(c[0])).join("");
    expect(err).not.toMatch(/ignored/);
    stderr.mockRestore();
  });
});

describe("webhooks trigger — body overrides", () => {
  it("includes orderId, amount, paymentMethod, status when supplied", async () => {
    await (trigger.run as any)({
      args: {
        event: "PAYMENTS_STATUS",
        orderId: "custom-order-001",
        amount: "50.00",
        paymentMethod: "CARD",
        status: "AUTHORIZED"
      },
      rawArgs: ["PAYMENTS_STATUS"]
    });
    expect(mock.requests[0].body).toMatchObject({
      eventType: "PAYMENTS_STATUS",
      orderId: "custom-order-001",
      amount: 50,
      paymentMethod: "CARD",
      status: "AUTHORIZED"
    });
  });

  it("rejects non-numeric --amount", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (trigger.run as any)({
      args: {event: "PAYMENTS_STATUS", amount: "NOT_A_NUMBER"},
      rawArgs: ["PAYMENTS_STATUS"]
    });
    expect(process.exitCode).toBe(3);
    expect(mock.requests).toHaveLength(0);
    stderr.mockRestore();
  });

  it("rejects unknown --status", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (trigger.run as any)({
      args: {event: "PAYMENTS_STATUS", status: "MADE_UP"},
      rawArgs: ["PAYMENTS_STATUS"]
    });
    expect(process.exitCode).toBe(3);
    stderr.mockRestore();
  });

  it("rejects unknown --paymentMethod", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (trigger.run as any)({
      args: {event: "PAYMENTS_STATUS", paymentMethod: "BITCOIN"},
      rawArgs: ["PAYMENTS_STATUS"]
    });
    expect(process.exitCode).toBe(3);
    stderr.mockRestore();
  });
});

describe("webhooks trigger — POS multi-shape (server validates)", () => {
  it("passes --type through verbatim (server is the validator)", async () => {
    await (trigger.run as any)({
      args: {event: "POS_PAYMENT_STATUS", type: "REFUND_STATUS"},
      rawArgs: ["POS_PAYMENT_STATUS"]
    });
    expect(mock.requests[0].body.type).toBe("REFUND_STATUS");
  });

  it("uppercases --type for consistency on the wire", async () => {
    await (trigger.run as any)({
      args: {event: "POS_PAYMENT_STATUS", type: "refund_status"},
      rawArgs: ["POS_PAYMENT_STATUS"]
    });
    expect(mock.requests[0].body.type).toBe("REFUND_STATUS");
  });

  it("parses --customFields as JSON array", async () => {
    await (trigger.run as any)({
      args: {
        event: "POS_PAYMENT_STATUS",
        customFields: '[{"value":"42","fieldName":"LoyaltyNumber"}]'
      },
      rawArgs: ["POS_PAYMENT_STATUS"]
    });
    expect(mock.requests[0].body.customFields).toEqual([{value: "42", fieldName: "LoyaltyNumber"}]);
  });

  it("rejects malformed --customFields JSON", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (trigger.run as any)({
      args: {event: "POS_PAYMENT_STATUS", customFields: "{not valid"},
      rawArgs: ["POS_PAYMENT_STATUS"]
    });
    expect(process.exitCode).toBe(3);
    stderr.mockRestore();
  });

  it("rejects --customFields that isn't an array", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (trigger.run as any)({
      args: {event: "POS_PAYMENT_STATUS", customFields: '{"value":"x"}'},
      rawArgs: ["POS_PAYMENT_STATUS"]
    });
    expect(process.exitCode).toBe(3);
    stderr.mockRestore();
  });

  it("does NOT enforce POS-only client-side — sends --type even on non-POS events (server rejects)", async () => {
    // Regression check for finding G: client used to pre-block this.
    await (trigger.run as any)({
      args: {event: "PAYMENTS_STATUS", type: "REFUND_STATUS"},
      rawArgs: ["PAYMENTS_STATUS"]
    });
    // Request DID go through to the server (server returns the rejection, not the CLI)
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].body.type).toBe("REFUND_STATUS");
  });
});

describe("webhooks trigger — dryRun", () => {
  it("does not send when --dryRun is set (ctx.dryRun reflects args.dryRun)", async () => {
    await (trigger.run as any)({args: {event: "PAYMENTS_STATUS", dryRun: true}, rawArgs: ["PAYMENTS_STATUS"]});
    expect(mock.requests).toHaveLength(0);
  });
});
