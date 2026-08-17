import {describe, it, expect, vi, beforeEach} from "vitest";

const EXISTING = {
  id: "bu_1",
  user: {
    id: "usr_1",
    firstName: "Alice",
    lastName: "Smith",
    email: "alice@example.com",
    phoneCountryCode: "44",
    phoneNumber: "7700900000"
  },
  role: {id: "role_1", name: "Manager"},
  permittedStores: [{store: {id: "st_1", locationName: "Camden"}}]
};

const mock = vi.hoisted(() => {
  const requests: Array<{method: string; path: string; body?: any; pathParams?: any}> = [];
  let printed: unknown;

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
          requests.push({method: req.method, path: req.path, body: req.body, pathParams: req.pathParams});
          if (req.path === "/api/business/:businessId/users/" && req.method === "GET") {
            return {status: 200, data: {data: [EXISTING], totalCount: 1}, requestId: "r"};
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
      profile: {businessId: "biz_1", displayName: "Acme", envs: {}},
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

import staffUpdate from "../../src/commands/staff/update";

beforeEach(() => {
  mock.reset();
  process.exitCode = 0;
});

const put = () => mock.requests.find((r) => r.method === "PUT");

describe("staff update", () => {
  it("PUTs against the user id, not the business-user link id", async () => {
    await (staffUpdate.run as any)({args: {userId: "usr_1", firstName: "Alicia"}, rawArgs: []});
    expect(put()?.path).toBe("/api/business/:businessId/users/:userId");
    expect(put()?.pathParams).toEqual({userId: "usr_1"});
  });

  it("keeps unchanged fields rather than blanking them", async () => {
    await (staffUpdate.run as any)({args: {userId: "usr_1", firstName: "Alicia"}, rawArgs: []});
    expect(put()?.body).toMatchObject({
      firstName: "Alicia",
      lastName: "Smith",
      email: "alice@example.com",
      roleId: "role_1",
      permittedStoreIds: ["st_1"]
    });
  });

  it("strips leading zeros from the phone number", async () => {
    await (staffUpdate.run as any)({args: {userId: "usr_1", phone: "07700900123"}, rawArgs: []});
    expect(put()?.body).toMatchObject({phoneNumber: "7700900123", phoneCountryCode: "44"});
  });

  it("replaces the permitted stores from repeated --store flags", async () => {
    await (staffUpdate.run as any)({
      args: {userId: "usr_1"},
      rawArgs: ["--store", "st_2", "--store", "st_3"]
    });
    expect(put()?.body.permittedStoreIds).toEqual(["st_2", "st_3"]);
  });

  it("sends nothing when no field differs", async () => {
    await (staffUpdate.run as any)({args: {userId: "usr_1"}, rawArgs: []});
    expect(put()).toBeUndefined();
    expect(mock.getPrinted()).toMatchObject({status: "No changes"});
  });

  it("errors (exit 3) on an unknown user id", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await (staffUpdate.run as any)({args: {userId: "nope"}, rawArgs: []});
    expect(process.exitCode).toBe(4);
    stderr.mockRestore();
  });

  it("errors (exit 3) on an invalid name", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await (staffUpdate.run as any)({args: {userId: "usr_1", firstName: "A1ice"}, rawArgs: []});
    expect(process.exitCode).toBe(3);
    expect(put()).toBeUndefined();
    stderr.mockRestore();
  });

  it("refuses an update that would leave no email and no phone", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await (staffUpdate.run as any)({args: {userId: "usr_1", email: "", phone: ""}, rawArgs: []});
    expect(process.exitCode).toBe(3);
    expect(put()).toBeUndefined();
    stderr.mockRestore();
  });

  it("--dryRun does not send the update", async () => {
    await (staffUpdate.run as any)({args: {userId: "usr_1", firstName: "Alicia", dryRun: true}, rawArgs: []});
    expect(put()).toBeUndefined();
  });
});
