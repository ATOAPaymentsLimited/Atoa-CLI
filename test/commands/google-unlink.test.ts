import {describe, it, expect, vi, beforeEach, afterEach} from "vitest";

/**
 * Unlinking answers 200 with the store id echoed back even when its DELETE matched no row, so the
 * response alone cannot tell a removal from a no-op. These pin the two guards that make up for it:
 * only linked stores are offered, and the listing is read back before success is reported.
 */
vi.mock("@inquirer/prompts", () => ({
  input: vi.fn(async () => ""),
  select: vi.fn(async () => ""),
  confirm: vi.fn(async () => true),
  Separator: class {
    readonly type = "separator";
  }
}));

const LINKED = {
  merchantStoreId: "st_1",
  metaData: {metadata: {title: "Ma Berrys", address: "20 West St, Portadown", placeId: "p_berrys"}}
};

const mock = vi.hoisted(() => {
  const requests: Array<{method: string; path: string; pathParams?: any}> = [];
  return {
    requests,
    linked: [] as unknown[],
    /** Whether the DELETE actually removes the row — false reproduces the silent no-op. */
    deleteWorks: true,
    formatExplicit: false,
    reset() {
      requests.length = 0;
      this.deleteWorks = true;
      this.formatExplicit = false;
    },
    buildContext: async (opts: any) => ({
      env: "sandbox",
      http: {
        baseUrl: "https://api.atoa.me",
        request: async (req: any) => {
          requests.push({method: req.method, path: req.path, pathParams: req.pathParams});
          // Checked first: the unlink path also ends in the linked-locations path's prefix.
          if (req.path?.includes("unlink-location")) {
            if (mock.deleteWorks) mock.linked = [];
            return {status: 200, data: req.pathParams?.storeId, requestId: "r"};
          }
          return {status: 200, data: mock.linked, requestId: "r"};
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
      print: (v: unknown) => mock.printed.push(v),
      printed: [] as unknown[]
    }),
    printed: [] as unknown[]
  };
});

vi.mock("../../src/lib/context", async () => {
  const actual = await vi.importActual<any>("../../src/lib/context");
  return {...actual, buildContext: mock.buildContext};
});

import googleUnlink from "../../src/commands/google/unlink";
import * as prompts from "@inquirer/prompts";

const deleteCall = () => mock.requests.find((r) => r.path?.includes("unlink-location"));

describe("google unlink", () => {
  const origStdout = process.stdout.isTTY;

  beforeEach(() => {
    mock.reset();
    mock.linked = [LINKED];
    mock.printed.length = 0;
    process.exitCode = 0;
    vi.clearAllMocks();
    (process.stdout as any).isTTY = true;
  });

  afterEach(() => {
    (process.stdout as any).isTTY = origStdout;
  });

  it("removes the link for the named store", async () => {
    await (googleUnlink.run as any)({args: {store: "st_1", yes: true}, rawArgs: []});

    expect(deleteCall()?.pathParams).toMatchObject({storeId: "st_1"});
    expect(mock.printed[0]).toMatchObject({status: "unlinked", store: "st_1", placeId: "p_berrys"});
  });

  it("offers only stores that actually carry a link", async () => {
    vi.mocked(prompts.select).mockResolvedValueOnce("st_1");

    await (googleUnlink.run as any)({args: {yes: true}, rawArgs: []});

    const picker = vi.mocked(prompts.select).mock.calls[0][0] as any;
    expect(picker.choices).toEqual([{name: "Ma Berrys — 20 West St, Portadown", value: "st_1"}]);
    expect(deleteCall()?.pathParams).toMatchObject({storeId: "st_1"});
  });

  it("refuses a store with no link rather than issuing a no-op delete", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await (googleUnlink.run as any)({args: {store: "st_other", yes: true}, rawArgs: []});
    stderr.mockRestore();

    expect(deleteCall()).toBeUndefined();
    expect(process.exitCode).toBe(4);
  });

  it("exits 4 when the business has no linked listing at all", async () => {
    mock.linked = [];
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await (googleUnlink.run as any)({args: {store: "st_1", yes: true}, rawArgs: []});
    stderr.mockRestore();

    expect(deleteCall()).toBeUndefined();
    expect(process.exitCode).toBe(4);
  });

  it("reports failure when the link survives the delete", async () => {
    mock.deleteWorks = false;
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await (googleUnlink.run as any)({args: {store: "st_1", yes: true}, rawArgs: []});
    stderr.mockRestore();

    expect(deleteCall()).toBeDefined(); // it was attempted, and 200 came back
    expect(mock.printed).toHaveLength(0); // but nothing is reported as unlinked
    expect(process.exitCode).toBe(1);
  });

  it("needs --yes when there is no terminal", async () => {
    mock.formatExplicit = true;
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await (googleUnlink.run as any)({args: {store: "st_1", output: "json"}, rawArgs: []});
    stderr.mockRestore();

    expect(prompts.confirm).not.toHaveBeenCalled();
    expect(deleteCall()).toBeUndefined();
    expect(process.exitCode).toBe(3);
  });
});
