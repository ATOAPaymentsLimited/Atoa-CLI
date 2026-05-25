import {describe, it, expect, vi} from "vitest";
import {walkAllPages} from "../../src/lib/pagination";

describe("walkAllPages — page/content envelope shape", () => {
  it("stops immediately when `last: true` on the first page (no wasted round-trip)", async () => {
    const fetchPage = vi.fn(async (_page: number) => ({
      content: [{id: "a"}, {id: "b"}, {id: "c"}],
      last: true,
      totalPages: 1,
      number: 0
    }));

    const out = await walkAllPages({pageSize: 20, fetchPage});
    expect(out).toEqual([{id: "a"}, {id: "b"}, {id: "c"}]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(0);
  });

  it("walks every page until `last: true`", async () => {
    const pages = [
      {content: [1, 2], last: false, totalPages: 3, number: 0},
      {content: [3, 4], last: false, totalPages: 3, number: 1},
      {content: [5], last: true, totalPages: 3, number: 2}
    ];
    const fetchPage = vi.fn(async (page: number) => pages[page]);

    const out = await walkAllPages({pageSize: 2, fetchPage});
    expect(out).toEqual([1, 2, 3, 4, 5]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(fetchPage).toHaveBeenNthCalledWith(1, 0);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 1);
    expect(fetchPage).toHaveBeenNthCalledWith(3, 2);
  });

  it("`last` wins over `hasMore` and `totalPages` when present", async () => {
    // last: true here would short-circuit before anything else evaluates
    const fetchPage = vi.fn(async (_page: number) => ({
      content: ["x"],
      last: true,
      hasMore: true, // contradicts `last` — `last` should win
      totalPages: 999,
      number: 0
    }));

    const out = await walkAllPages({pageSize: 1, fetchPage});
    expect(out).toEqual(["x"]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});

describe("walkAllPages — hasMore stop signal", () => {
  it("stops when `hasMore: false`", async () => {
    const pages = [
      {data: [{n: 1}], hasMore: true},
      {data: [{n: 2}], hasMore: false}
    ];
    const fetchPage = vi.fn(async (page: number) => pages[page]);

    const out = await walkAllPages({pageSize: 1, fetchPage});
    expect(out).toEqual([{n: 1}, {n: 2}]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });
});

describe("walkAllPages — totalPages + number arithmetic", () => {
  it("stops at `number >= totalPages - 1`", async () => {
    const pages = [
      {data: [1], totalPages: 2, number: 0},
      {data: [2], totalPages: 2, number: 1}
    ];
    const fetchPage = vi.fn(async (page: number) => pages[page]);

    const out = await walkAllPages({pageSize: 1, fetchPage});
    expect(out).toEqual([1, 2]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });
});

describe("walkAllPages — short-page heuristic fallback", () => {
  it("stops when items.length < pageSize (no server hints present)", async () => {
    const pages = [
      {data: [1, 2, 3]}, // full page (size 3)
      {data: [4, 5]} // short page → stop
    ];
    const fetchPage = vi.fn(async (page: number) => pages[page]);

    const out = await walkAllPages({pageSize: 3, fetchPage});
    expect(out).toEqual([1, 2, 3, 4, 5]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("DOES cost one wasted round-trip on exact-fill when no server hints (documented behaviour)", async () => {
    const pages = [
      {data: [1, 2]}, // exactly pageSize
      {data: []} // server returns empty → short-page heuristic fires
    ];
    const fetchPage = vi.fn(async (page: number) => pages[page]);

    const out = await walkAllPages({pageSize: 2, fetchPage});
    expect(out).toEqual([1, 2]);
    // The wasted call is the bare-envelope cost; server-hint envelopes (last/hasMore) avoid it
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });
});

describe("walkAllPages — item extraction across response shapes", () => {
  it("extracts from `content` envelope", async () => {
    const fetchPage = vi.fn(async () => ({content: ["a", "b"], last: true}));
    const out = await walkAllPages({pageSize: 10, fetchPage});
    expect(out).toEqual(["a", "b"]);
  });

  it("extracts from `data` (bare envelope)", async () => {
    const fetchPage = vi.fn(async () => ({data: ["a", "b"], hasMore: false}));
    const out = await walkAllPages({pageSize: 10, fetchPage});
    expect(out).toEqual(["a", "b"]);
  });

  it("extracts from top-level array", async () => {
    // Top-level array has no envelope; walker falls back to short-page heuristic
    // (length < pageSize on a single-page array stops immediately).
    const fetchPage = vi.fn(async () => ["a", "b"]);
    const out = await walkAllPages({pageSize: 10, fetchPage});
    expect(out).toEqual(["a", "b"]);
  });

  it("returns empty when response shape is unrecognized", async () => {
    const fetchPage = vi.fn(async () => ({notContentNorData: ["x"], last: true}));
    const out = await walkAllPages({pageSize: 10, fetchPage});
    expect(out).toEqual([]);
  });

  it("prefers `content` when both `content` and `data` are present", async () => {
    const fetchPage = vi.fn(async () => ({
      content: ["from-content"],
      data: ["from-data"], // should be ignored
      last: true
    }));
    const out = await walkAllPages({pageSize: 10, fetchPage});
    expect(out).toEqual(["from-content"]);
  });
});

describe("walkAllPages — maxPages guard", () => {
  it("throws when walker hits the default maxPages bound (1000)", async () => {
    // Server that lies — claims hasMore=true forever with full pages.
    const fetchPage = vi.fn(async () => ({data: [1, 2], hasMore: true}));

    await expect(walkAllPages({pageSize: 2, fetchPage})).rejects.toThrow(/pagination guard.*1000 pages/);
    expect(fetchPage).toHaveBeenCalledTimes(1000);
  });

  it("respects a custom maxPages override", async () => {
    const fetchPage = vi.fn(async () => ({data: ["x", "y"], hasMore: true}));

    await expect(walkAllPages({pageSize: 2, fetchPage, maxPages: 5})).rejects.toThrow(/walked 5 pages/);
    expect(fetchPage).toHaveBeenCalledTimes(5);
  });

  it("guard error names the page size in the message (debuggability)", async () => {
    const fetchPage = vi.fn(async () => ({data: ["x"], hasMore: true}));
    await expect(walkAllPages({pageSize: 17, fetchPage, maxPages: 3})).rejects.toThrow(/3 pages of 17/);
  });
});

describe("walkAllPages — propagation + ordering", () => {
  it("propagates fetchPage rejections without retry", async () => {
    const err = new Error("network timeout");
    const fetchPage = vi.fn(async (page: number) => {
      if (page === 1) throw err;
      return {data: [page], hasMore: true};
    });

    await expect(walkAllPages({pageSize: 1, fetchPage})).rejects.toThrow("network timeout");
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("preserves item order across pages", async () => {
    const pages = [
      {content: ["a", "b"], last: false},
      {content: ["c", "d"], last: false},
      {content: ["e"], last: true}
    ];
    const fetchPage = vi.fn(async (page: number) => pages[page]);
    const out = await walkAllPages({pageSize: 2, fetchPage});
    expect(out).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("calls fetchPage with 0-indexed page numbers in order", async () => {
    const pages = [
      {content: [1, 2, 3], last: false},
      {content: [4, 5, 6], last: false},
      {content: [7], last: true}
    ];
    const fetchPage = vi.fn(async (page: number) => pages[page]);
    await walkAllPages({pageSize: 3, fetchPage});
    expect(fetchPage.mock.calls.map((c) => c[0])).toEqual([0, 1, 2]);
  });

  it("treats an empty page as terminal even when the server hint disagrees", async () => {
    // Defends against misbehaving servers that return {last: false, content: []}
    // forever. Without this guard the walker would request maxPages (~1000)
    // empty responses before hitting the AtoaError — hours of wall-clock.
    const fetchPage = vi.fn(async () => ({content: [], last: false}));
    const out = await walkAllPages({pageSize: 10, fetchPage});
    expect(out).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
