import {describe, it, expect, vi, beforeEach} from "vitest";

/**
 * sessions list + sessions revoke tests.
 *
 * Verifies:
 *   - sessions list → GET /api/user/auth/sessions, prints data
 *   - sessions revoke confirms + calls DELETE + --yes bypass + non-TTY without --yes fails
 */

const mock = vi.hoisted(() => {
  const requests: Array<{method: string; path: string; pathParams?: any; query?: any; auth?: string}> = [];
  let printed: unknown = undefined;
  let sessionList: any[] = [
    {id: "dev_1", source: "browser", deviceName: "MacBook Pro", lastUsedAt: "2024-01-01", createdAt: "2024-01-01"},
    {id: "dev_2", source: "mobile", deviceName: "iPhone", lastUsedAt: "2024-01-02", createdAt: "2024-01-02"}
  ];
  // Server-side page size the mock actually honours — lets tests force multiple
  // fetchAllPages round-trips without needing 100+ fake sessions.
  let pageSize = 100;

  return {
    requests,
    getPrinted: () => printed,
    setSessionList(l: any[], size = 100) {
      sessionList = l;
      pageSize = size;
    },
    reset() {
      requests.length = 0;
      printed = undefined;
      pageSize = 100;
      sessionList = [
        {id: "dev_1", source: "browser", deviceName: "MacBook Pro", lastUsedAt: "2024-01-01", createdAt: "2024-01-01"},
        {id: "dev_2", source: "mobile", deviceName: "iPhone", lastUsedAt: "2024-01-02", createdAt: "2024-01-02"}
      ];
    },
    buildContext: async (opts: any) => ({
      env: "sandbox",
      http: {
        baseUrl: "https://api.atoa.me",
        request: async (req: any) => {
          requests.push({
            method: req.method,
            path: req.path,
            pathParams: req.pathParams,
            query: req.query,
            auth: req.auth
          });
          if (req.path === "/api/user/auth/sessions" && req.method === "GET") {
            // Mirrors the real backend's `{data, totalCount, page, size}` Pageable envelope.
            const page = Number(req.query?.page ?? 0);
            const rows = sessionList.slice(page * pageSize, page * pageSize + pageSize);
            return {
              status: 200,
              data: {data: rows, totalCount: sessionList.length, page, size: pageSize},
              requestId: "r"
            };
          }
          if (req.path === "/api/user/auth/sessions/:deviceId" && req.method === "DELETE") {
            return {status: 200, data: {}, requestId: "r"};
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

// Mock @inquirer/prompts so tests never wait for TTY input
vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(async () => true) // default: user confirms
}));

import sessionsList from "../../src/commands/sessions/list";
import sessionsRevoke from "../../src/commands/sessions/revoke";
import * as prompts from "@inquirer/prompts";

beforeEach(() => {
  mock.reset();
  process.exitCode = 0;
  vi.mocked(prompts.confirm).mockResolvedValue(true);
});

describe("sessions list", () => {
  it("GETs /api/user/auth/sessions with jwt auth and page/size query params", async () => {
    await (sessionsList.run as any)({args: {}, rawArgs: []});
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].method).toBe("GET");
    expect(mock.requests[0].path).toBe("/api/user/auth/sessions");
    expect(mock.requests[0].auth).toBe("jwt");
    expect(mock.requests[0].query).toEqual({page: "0", size: "50"});
  });

  it("prints the sessions list (unwrapping the {data, totalCount, page, size} envelope)", async () => {
    await (sessionsList.run as any)({args: {}, rawArgs: []});
    const data = mock.getPrinted() as any[];
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(2);
    expect(data[0].id).toBe("dev_1");
  });

  it("walks every page and aggregates all sessions when the server paginates", async () => {
    // 5 sessions, server only returns 2 per page — forces fetchAllPages through 3 requests.
    const many = Array.from({length: 5}, (_, i) => ({id: `dev_${i}`, source: "cli", deviceName: `Device ${i}`}));
    mock.setSessionList(many, 2);

    await (sessionsList.run as any)({args: {}, rawArgs: []});

    expect(mock.requests).toHaveLength(3);
    expect(mock.requests.map((r) => r.query.page)).toEqual(["0", "1", "2"]);
    const data = mock.getPrinted() as any[];
    expect(data).toHaveLength(5);
    expect(data.map((s) => s.id)).toEqual(many.map((s) => s.id));
  });
});

describe("sessions revoke", () => {
  it("DELETEs /api/user/auth/sessions/:deviceId when --yes is set", async () => {
    await (sessionsRevoke.run as any)({args: {deviceId: "dev_1", yes: true}, rawArgs: ["dev_1"]});
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].method).toBe("DELETE");
    expect(mock.requests[0].path).toBe("/api/user/auth/sessions/:deviceId");
    expect(mock.requests[0].pathParams).toEqual({deviceId: "dev_1"});
    expect(mock.requests[0].auth).toBe("jwt");
  });

  it("confirms before deleting when --yes is not set (TTY path)", async () => {
    // Simulate TTY
    const origIsTTY = process.stdin.isTTY;
    (process.stdin as any).isTTY = true;

    vi.mocked(prompts.confirm).mockResolvedValueOnce(true);
    await (sessionsRevoke.run as any)({args: {deviceId: "dev_2", yes: false}, rawArgs: ["dev_2"]});

    expect(vi.mocked(prompts.confirm)).toHaveBeenCalled();
    expect(mock.requests).toHaveLength(1);

    (process.stdin as any).isTTY = origIsTTY;
  });

  it("aborts when user declines the confirm prompt", async () => {
    const origIsTTY = process.stdin.isTTY;
    (process.stdin as any).isTTY = true;

    vi.mocked(prompts.confirm).mockResolvedValueOnce(false);
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await (sessionsRevoke.run as any)({args: {deviceId: "dev_1", yes: false}, rawArgs: ["dev_1"]});

    expect(mock.requests).toHaveLength(0);
    const out = stdout.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toMatch(/Aborted/);

    stdout.mockRestore();
    (process.stdin as any).isTTY = origIsTTY;
  });

  it("errors in non-TTY mode without --yes", async () => {
    const origIsTTY = process.stdin.isTTY;
    (process.stdin as any).isTTY = false;

    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (sessionsRevoke.run as any)({args: {deviceId: "dev_1", yes: false}, rawArgs: ["dev_1"]});

    expect(mock.requests).toHaveLength(0);
    expect(process.exitCode).toBe(3); // validation

    stderr.mockRestore();
    (process.stdin as any).isTTY = origIsTTY;
  });

  it("--dryRun does not send the request", async () => {
    await (sessionsRevoke.run as any)({args: {deviceId: "dev_1", yes: true, dryRun: true}, rawArgs: ["dev_1"]});
    expect(mock.requests).toHaveLength(0);
  });

  it("prints a warning about the current device", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await (sessionsRevoke.run as any)({args: {deviceId: "dev_1", yes: true}, rawArgs: ["dev_1"]});
    const errOut = stderr.mock.calls.map((c) => String(c[0])).join("");
    expect(errOut).toMatch(/current device|re-authenticate/i);
    stderr.mockRestore();
  });
});
