import {describe, it, expect, vi, beforeEach} from "vitest";

const mock = vi.hoisted(() => {
  const requests: Array<{method: string; path: string; auth?: string; body?: any}> = [];
  let printed: unknown;

  const topics = [
    {
      topicId: "payouts",
      displayName: "Payouts",
      description: "desc",
      hasPermission: true,
      channels: [
        {channel: "EMAIL", isEnabled: true, isAvailable: true},
        {channel: "SMS", isEnabled: false, isAvailable: false, unavailableReason: "SMS not enabled for this business"},
        {channel: "PUSH", isEnabled: true, isAvailable: true}
      ]
    },
    {
      topicId: "marketing",
      displayName: "Marketing",
      description: "desc",
      hasPermission: false,
      noPermissionMessage: "no access",
      channels: []
    }
  ];

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
          requests.push({method: req.method, path: req.path, auth: req.auth, body: req.body});
          if (req.path === "/api/business/:businessId/communication-preferences" && req.method === "GET") {
            return {status: 200, data: {topics}, requestId: "r"};
          }
          if (req.path === "/api/business/:businessId/communication-preferences" && req.method === "PUT") {
            return {status: 200, data: {topics}, requestId: "r"};
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

import commsList from "../../src/commands/comms/list";
import commsSet from "../../src/commands/comms/set";

beforeEach(() => {
  mock.reset();
  process.exitCode = 0;
});

describe("comms list", () => {
  it("GETs communication-preferences and prints the topics", async () => {
    await (commsList.run as any)({args: {}, rawArgs: []});
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].method).toBe("GET");
    const data = mock.getPrinted() as any[];
    expect(data[0].topicId).toBe("payouts");
  });
});

describe("comms set", () => {
  it("resolves the topic by id and PUTs only the requested channel", async () => {
    await (commsSet.run as any)({args: {topic: "payouts", email: "off"}, rawArgs: []});
    const putReq = mock.requests.find((r) => r.method === "PUT");
    expect(putReq).toBeDefined();
    expect(putReq!.body).toMatchObject({preferences: [{topicId: "payouts", emailEnabled: false}]});
  });

  it("resolves the topic by display name (case-insensitive)", async () => {
    await (commsSet.run as any)({args: {topic: "PAYOUTS", email: "on"}, rawArgs: []});
    const putReq = mock.requests.find((r) => r.method === "PUT");
    expect(putReq!.body).toMatchObject({preferences: [{topicId: "payouts", emailEnabled: true}]});
  });

  it("refuses when the channel is unavailable, using the backend's reason", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    let printedError = "";
    stderr.mockImplementation((chunk: any) => {
      printedError += chunk;
      return true;
    });
    await (commsSet.run as any)({args: {topic: "payouts", sms: "on"}, rawArgs: []});
    expect(process.exitCode).toBe(3);
    expect(printedError).toContain("SMS not enabled for this business");
    expect(mock.requests.some((r) => r.method === "PUT")).toBe(false);
    stderr.mockRestore();
  });

  it("refuses when the topic has no permission", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (commsSet.run as any)({args: {topic: "marketing", email: "off"}, rawArgs: []});
    expect(process.exitCode).toBe(2); // "forbidden" kind
    stderr.mockRestore();
  });

  it("errors (exit 3) when no channel flag is provided", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (commsSet.run as any)({args: {topic: "payouts"}, rawArgs: []});
    expect(process.exitCode).toBe(3);
    stderr.mockRestore();
  });

  it("errors (exit 3) when an on/off value is invalid", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (commsSet.run as any)({args: {topic: "payouts", email: "maybe"}, rawArgs: []});
    expect(process.exitCode).toBe(3);
    stderr.mockRestore();
  });

  it("--dryRun does not send the PUT", async () => {
    await (commsSet.run as any)({args: {topic: "payouts", email: "off", dryRun: true}, rawArgs: []});
    expect(mock.requests.some((r) => r.method === "PUT")).toBe(false);
  });
});
