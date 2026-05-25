import {AtoaError} from "./errors";

const DEFAULT_MAX_PAGES = 1000;

export interface WalkPagesOptions {
  /** Page size the caller requested — used as the partial-page stop signal of last resort. */
  pageSize: number;
  /** Fetches one page; receives a 0-indexed page number, returns the raw response body. */
  fetchPage: (page: number) => Promise<unknown>;
  /** Defaults to 1000. Throws AtoaError("generic") if the walker reaches this. */
  maxPages?: number;
}

/**
 * Walk an offset/page-paginated endpoint until the last page is reached.
 *
 * Stop conditions, in priority order:
 *   1. `last: true` in the response body — authoritative, no extra round-trip.
 *   2. `hasMore: false`.
 *   3. `totalPages` + `number` — stop at `number >= totalPages - 1`.
 *   4. Items returned < `pageSize` — partial-page heuristic, used only when
 *      no explicit pagination hint is present. Costs one wasted empty
 *      round-trip on exact-fill.
 *
 * Always bounded by `maxPages` — a runaway response that never signals "last"
 * raises a clear AtoaError instead of looping indefinitely.
 */
export async function walkAllPages<T = unknown>(opts: WalkPagesOptions): Promise<T[]> {
  const max = opts.maxPages ?? DEFAULT_MAX_PAGES;
  const out: T[] = [];

  for (let page = 0; page < max; page++) {
    const data = await opts.fetchPage(page);
    const items = extractItems<T>(data);
    out.push(...items);
    if (isLastPage(data, items, opts.pageSize)) return out;
  }

  throw new AtoaError(
    `pagination guard: walked ${max} pages of ${opts.pageSize} without hitting a final page. ` +
      `Server may be returning the same page repeatedly — re-run without --pageAll to inspect, or contact support.`,
    "generic"
  );
}

function extractItems<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d.content)) return d.content as T[];
    if (Array.isArray(d.data)) return d.data as T[];
  }
  return [];
}

function isLastPage(data: unknown, items: unknown[], pageSize: number): boolean {
  if (items.length === 0) return true;
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (typeof d.last === "boolean") return d.last;
    if (typeof d.hasMore === "boolean") return !d.hasMore;
    if (typeof d.totalPages === "number" && typeof d.number === "number") {
      return d.number >= d.totalPages - 1;
    }
  }
  return items.length < pageSize;
}
