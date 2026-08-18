import type {CommandContext} from "./context";
import type {HttpMethod, AuthMode} from "./http";
import {stripControlChars} from "./output";

/** Minimal route shape (matches V1_ROUTES entries: {method, path, auth}). */
type Route = {method: HttpMethod; path: string; auth: AuthMode};

export const DEFAULT_PAGE_SIZE = 50;

/**
 * Fetches every page of a list endpoint and returns a flat array of rows.
 * - Paginated endpoints return `{data, totalCount, page, size}` (Pageable is 0-based) — we loop
 *   pages until we've collected `totalCount` rows.
 * - Bare-array endpoints (no pagination) pass straight through on the first request.
 */
export async function fetchAllPages(
  ctx: CommandContext,
  route: Route,
  baseQuery: Record<string, string> = {},
  size: number = DEFAULT_PAGE_SIZE
): Promise<unknown[]> {
  const all: unknown[] = [];
  for (let page = 0; page < 1000; page++) {
    const {data} = await ctx.http.request({...route, query: {...baseQuery, page: String(page), size: String(size)}});
    if (Array.isArray(data)) return data; // endpoint isn't paginated — already the full list
    const env = (data ?? {}) as {data?: unknown[]; totalCount?: number};
    const rows = Array.isArray(env.data) ? env.data : [];
    all.push(...rows);
    const total = typeof env.totalCount === "number" ? env.totalCount : all.length;
    if (rows.length === 0 || all.length >= total) break;
  }
  return all;
}

/**
 * Presents a list of rows.
 * - Interactive TTY (no explicit --output): a scrollable picker — arrow through rows, Enter shows
 *   that row's full detail, "Close" / Ctrl-C exits.
 * - Piped or `--output json|yaml`: prints the raw rows so scripting is unaffected.
 */
export async function presentList(
  ctx: CommandContext,
  rows: unknown[],
  opts: {title?: string; line?: (row: Record<string, unknown>) => string} = {}
): Promise<void> {
  const interactive = Boolean(process.stdout.isTTY) && !ctx.formatExplicit;
  if (!interactive) {
    ctx.print(rows);
    return;
  }
  if (rows.length === 0) {
    process.stderr.write(`${opts.title ?? "Results"}: none\n`);
    return;
  }

  const {select} = await import("@inquirer/prompts");
  const line = opts.line ?? autoLine;
  const CLOSE = -1;

  for (;;) {
    let idx: number;
    try {
      idx = await select<number>({
        message: `${opts.title ?? "Results"} · ${rows.length} total`,
        pageSize: 12,
        loop: false,
        choices: [
          ...rows.map((r, i) => ({name: stripControlChars(line(r as Record<string, unknown>)), value: i})),
          {name: "— Close —", value: CLOSE}
        ]
      });
    } catch {
      return; // Ctrl-C / Esc
    }
    if (idx === CLOSE) return;
    process.stdout.write("\n");
    ctx.print(rows[idx]); // full detail of the chosen row (respects --output for the detail too)
    process.stdout.write("\n");
  }
}

/** Best-effort one-line summary when a command doesn't supply its own formatter. */
function autoLine(row: Record<string, unknown>): string {
  if (row === null || typeof row !== "object") return String(row);
  const prefer = ["name", "legalBusinessName", "tradingName", "locationName", "deviceName", "email", "title", "label"];
  const vals: string[] = [];
  for (const k of prefer) {
    if (vals.length >= 1) break;
    if (row[k] != null && typeof row[k] !== "object") vals.push(String(row[k]));
  }
  for (const [k, v] of Object.entries(row)) {
    if (vals.length >= 3) break;
    if (v == null || typeof v === "object") continue;
    if (prefer.includes(k)) continue;
    vals.push(`${k}: ${String(v)}`);
  }
  return vals.join("  ·  ") || JSON.stringify(row);
}
