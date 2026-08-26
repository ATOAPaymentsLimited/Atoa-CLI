import {describe, it, expect, vi, beforeEach, afterEach} from "vitest";

/**
 * The listing picker loops so a vague first search can be refined — a chain's name rarely lands on
 * the right branch. It used to loop unbounded with no visible exit, leaving Ctrl-C as the only way
 * out. These pin the three ways it can end: a pick, an explicit cancel, and the ceiling.
 */
vi.mock("@inquirer/prompts", () => ({
  input: vi.fn(async () => ""),
  select: vi.fn(async () => ""),
  confirm: vi.fn(async () => true),
  Separator: class {
    readonly type = "separator";
  }
}));

const PLACES = [
  {place_id: "p_soho", name: "Fitzrovia Barbers Soho", formatted_address: "5 Carlisle St, London", rating: 4.9},
  {place_id: "p_prom", name: "Ma Kellys On The Prom", formatted_address: "193 Promenade, Blackpool", rating: 4.5}
];

const mock = vi.hoisted(() => {
  const requests: Array<{method: string; path: string; body?: any; query?: any}> = [];
  return {
    requests,
    searchResults: [] as unknown[],
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
          requests.push({method: req.method, path: req.path, body: req.body, query: req.query});
          // Order matters: the search path is `merchant-stores/search-google-locations`, so a
          // bare "stores" check would swallow it and hand back the store list instead.
          if (req.path?.includes("search-google-locations")) {
            return {status: 200, data: mock.searchResults, requestId: "r"};
          }
          if (req.path?.includes("stores")) {
            return {
              status: 200,
              data: [{id: "st_1", locationName: "Soho", addressPostalCode: "W1D 3BL"}],
              requestId: "r"
            };
          }
          return {status: 200, data: {id: "link_1"}, requestId: "r"};
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

import googleLink from "../../src/commands/google/link";
import * as prompts from "@inquirer/prompts";

const linkCall = () => mock.requests.find((r) => r.path?.includes("link-location"));
const searchCount = () => mock.requests.filter((r) => r.path?.includes("search-google-locations")).length;

describe("google link — choosing a listing", () => {
  const origStdin = process.stdin.isTTY;
  const origStdout = process.stdout.isTTY;

  beforeEach(() => {
    mock.reset();
    mock.searchResults = PLACES;
    process.exitCode = 0;
    vi.clearAllMocks();
    (process.stdin as any).isTTY = true;
    (process.stdout as any).isTTY = true;
  });

  afterEach(() => {
    (process.stdin as any).isTTY = origStdin;
    (process.stdout as any).isTTY = origStdout;
  });

  it("links the chosen listing, carrying its name and address", async () => {
    vi.mocked(prompts.input).mockResolvedValueOnce("barbers soho");
    vi.mocked(prompts.select)
      .mockResolvedValueOnce("st_1") // store
      .mockResolvedValueOnce("p_soho"); // listing

    await (googleLink.run as any)({args: {}, rawArgs: []});

    expect(linkCall()?.body).toMatchObject({
      merchantStoreId: "st_1",
      placeId: "p_soho",
      businessName: "Fitzrovia Barbers Soho",
      businessAddress: "5 Carlisle St, London",
      storePostalCode: "W1D 3BL"
    });
  });

  it("searches again when asked, then links from the second round", async () => {
    vi.mocked(prompts.input).mockResolvedValueOnce("ma kellys").mockResolvedValueOnce("ma kellys promenade");
    vi.mocked(prompts.select)
      .mockResolvedValueOnce("st_1")
      .mockResolvedValueOnce("__search_again__")
      .mockResolvedValueOnce("p_prom");

    await (googleLink.run as any)({args: {}, rawArgs: []});

    expect(searchCount()).toBe(2);
    expect(linkCall()?.body).toMatchObject({placeId: "p_prom"});
  });

  it("cancels cleanly without linking anything", async () => {
    vi.mocked(prompts.input).mockResolvedValueOnce("barbers");
    vi.mocked(prompts.select).mockResolvedValueOnce("st_1").mockResolvedValueOnce("__cancel__");
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await (googleLink.run as any)({args: {}, rawArgs: []});
    stderr.mockRestore();

    expect(linkCall()).toBeUndefined();
    expect(process.exitCode).toBe(3);
  });

  it("stops after five fruitless searches instead of looping forever", async () => {
    mock.searchResults = [];
    vi.mocked(prompts.input).mockResolvedValue("nothing matches this");
    vi.mocked(prompts.select).mockResolvedValueOnce("st_1");
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await (googleLink.run as any)({args: {}, rawArgs: []});
    stderr.mockRestore();

    expect(searchCount()).toBe(5);
    expect(linkCall()).toBeUndefined();
    expect(process.exitCode).toBe(3);
  });

  it("keeps the picker to one page so the way out stays on screen", async () => {
    // A looping list long enough to scroll put Cancel part-way up the results, where it read as
    // one of them. Capping the listings keeps the actions visible without scrolling at all.
    mock.searchResults = Array.from({length: 20}, (_, i) => ({
      place_id: `p_${i}`,
      name: `St Mary's ${i}`,
      formatted_address: `${i} Church Rd`
    }));
    vi.mocked(prompts.input).mockResolvedValueOnce("st marys");
    vi.mocked(prompts.select).mockResolvedValueOnce("st_1").mockResolvedValueOnce("p_3");

    await (googleLink.run as any)({args: {}, rawArgs: []});

    const picker = vi.mocked(prompts.select).mock.calls[1][0] as any;
    expect(picker.loop).toBe(false);
    expect(picker.choices).toHaveLength(8 + 3); // listings, the rule, then search-again and cancel
    expect(picker.message).toContain("closest 8 of 20");
    expect(linkCall()?.body).toMatchObject({placeId: "p_3", businessName: "St Mary's 3"});
  });

  it("resolves --place-id back to its full record instead of sending blanks", async () => {
    mock.formatExplicit = true;

    await (googleLink.run as any)({
      args: {store: "st_1", placeId: "p_prom", search: "ma kellys", output: "json", yes: true},
      rawArgs: []
    });

    // Blank name/address would not merely look empty — the review service stores what it is sent
    // and replaces the record wholesale, so a re-link on a bare id wipes a listing that was right.
    expect(linkCall()?.body).toMatchObject({
      placeId: "p_prom",
      businessName: "Ma Kellys On The Prom",
      businessAddress: "193 Promenade, Blackpool"
    });
  });

  it("refuses --place-id on its own, since the id alone cannot yield a name or address", async () => {
    mock.formatExplicit = true;
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await (googleLink.run as any)({args: {store: "st_1", placeId: "p_prom", output: "json", yes: true}, rawArgs: []});
    stderr.mockRestore();

    expect(linkCall()).toBeUndefined();
    expect(process.exitCode).toBe(3);
  });

  it("rejects a --place-id that the search does not return", async () => {
    mock.formatExplicit = true;
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await (googleLink.run as any)({
      args: {store: "st_1", placeId: "p_not_here", search: "ma kellys", output: "json", yes: true},
      rawArgs: []
    });
    stderr.mockRestore();

    expect(linkCall()).toBeUndefined();
    expect(process.exitCode).toBe(3);
  });

  it("needs --place-id when there is no terminal", async () => {
    mock.formatExplicit = true;
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await (googleLink.run as any)({args: {store: "st_1", output: "json"}, rawArgs: []});
    stderr.mockRestore();

    expect(prompts.select).not.toHaveBeenCalled();
    expect(linkCall()).toBeUndefined();
    expect(process.exitCode).toBe(3);
  });
});
