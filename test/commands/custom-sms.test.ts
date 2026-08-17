import {describe, it, expect, vi, beforeEach} from "vitest";

const mock = vi.hoisted(() => {
  const requests: Array<{method: string; path: string; auth?: string; body?: any; pathParams?: any}> = [];
  let printed: unknown;

  return {
    requests,
    getPrinted: () => printed,
    reset() {
      requests.length = 0;
      printed = undefined;
    },
    existing: null as null | {id: string; customSmsName: string; status: string},
    buildContext: async (opts: any) => ({
      env: "sandbox",
      http: {
        baseUrl: "https://api.atoa.me",
        request: async (req: any) => {
          requests.push({
            method: req.method,
            path: req.path,
            auth: req.auth,
            body: req.body,
            pathParams: req.pathParams
          });
          if (req.path === "/api/merchant/custom-sender-name/:businessId" && req.method === "GET") {
            return {status: 200, data: mock.existing ?? false, requestId: "r"};
          }
          if (req.path === "/api/business/:businessId/options" && req.method === "PUT") {
            return {status: 200, data: {}, requestId: "r"};
          }
          if (req.path === "/api/merchant/custom-sender-name/:businessId" && req.method === "POST") {
            return {
              status: 200,
              data: {id: "csn_1", customSmsName: req.body.customSmsName, status: "IN_REVIEW"},
              requestId: "r"
            };
          }
          if (
            req.path === "/api/merchant/custom-sender-name/:businessId/updateDetails/:customOptionId" &&
            req.method === "PUT"
          ) {
            return {
              status: 200,
              data: {id: req.pathParams.customOptionId, customSmsName: req.body.customSmsName},
              requestId: "r"
            };
          }
          if (
            req.path === "/api/merchant/custom-sender-name/:businessId/delete-custom-options/:customOptionId" &&
            req.method === "DELETE"
          ) {
            return {status: 200, data: {}, requestId: "r"};
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

import smsNameSet from "../../src/commands/custom-sms/set";
import smsNameRemove from "../../src/commands/custom-sms/delete";
import smsNameList from "../../src/commands/custom-sms/list";

beforeEach(() => {
  mock.reset();
  mock.existing = null;
  process.exitCode = 0;
});

describe("custom-sms set", () => {
  it("first-ever create: runs the options pre-step, then POST, in order (2 requests)", async () => {
    await (smsNameSet.run as any)({args: {name: "Acme Cafe"}, rawArgs: []});
    // GET (check existing) → PUT options (pre-step) → POST create = 3 requests total.
    expect(mock.requests.map((r) => r.method)).toEqual(["GET", "PUT", "POST"]);
    expect(mock.requests[1].path).toBe("/api/business/:businessId/options");
    expect(mock.requests[1].body).toMatchObject({options: {allowBusinessCustomBrandingSms: true}});
    expect(mock.requests[2].body).toMatchObject({customSmsName: "Acme Cafe"});
  });

  it("update: skips the pre-step, PUTs updateDetails directly", async () => {
    mock.existing = {id: "csn_1", customSmsName: "Old Name", status: "APPROVED"};
    await (smsNameSet.run as any)({args: {name: "New Name"}, rawArgs: []});
    expect(mock.requests.map((r) => r.method)).toEqual(["GET", "PUT"]);
    expect(mock.requests[1].path).toBe("/api/merchant/custom-sender-name/:businessId/updateDetails/:customOptionId");
    expect(mock.requests[1].pathParams).toMatchObject({customOptionId: "csn_1"});
    expect(mock.requests[1].body).toMatchObject({customSmsName: "New Name"});
  });

  it("errors (exit 3) when name is empty", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (smsNameSet.run as any)({args: {name: "  "}, rawArgs: []});
    expect(process.exitCode).toBe(3);
    stderr.mockRestore();
  });
});

describe("custom-sms delete", () => {
  it("DELETEs using the existing record's id", async () => {
    mock.existing = {id: "csn_1", customSmsName: "Acme", status: "APPROVED"};
    await (smsNameRemove.run as any)({args: {}, rawArgs: []});
    const delReq = mock.requests.find((r) => r.method === "DELETE");
    expect(delReq).toBeDefined();
    expect(delReq!.pathParams).toMatchObject({customOptionId: "csn_1"});
  });

  it("errors (not_found) when nothing is set", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (smsNameRemove.run as any)({args: {}, rawArgs: []});
    expect(process.exitCode).toBe(4);
    stderr.mockRestore();
  });
});

describe("custom-sms list", () => {
  it("prints null when nothing is set (scripting output)", async () => {
    await (smsNameList.run as any)({args: {}, rawArgs: []});
    expect(mock.getPrinted()).toBeNull();
  });

  it("prints the existing record", async () => {
    mock.existing = {id: "csn_1", customSmsName: "Acme", status: "APPROVED"};
    await (smsNameList.run as any)({args: {}, rawArgs: []});
    expect(mock.getPrinted()).toMatchObject({id: "csn_1", customSmsName: "Acme"});
  });
});
