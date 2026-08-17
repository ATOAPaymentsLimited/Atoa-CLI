/**
 * Output formatting: --output json | table | yaml.
 *
 * Default: table. `resolveFormat(undefined)` returns "table" — a raw JSON dump is not a
 * readable answer to `atoa stores list`. Scripts opt into `--output json` explicitly.
 * Errors always go to stderr; data always to stdout.
 */

import Table from "cli-table3";
import * as yaml from "js-yaml";

export type OutputFormat = "json" | "table" | "yaml";

const C = {
  reset: "\x1b[0m",
  key: "\x1b[36m", // cyan
  string: "\x1b[32m", // green
  number: "\x1b[33m", // yellow
  boolean: "\x1b[34m", // blue
  null: "\x1b[2;31m" // dim red
};

const JSON_TOKEN = /("(?:\\u[0-9a-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g;

function colorizeJson(data: unknown): string {
  const raw = JSON.stringify(data, null, 2);
  if (!process.stdout.isTTY) return raw;
  return raw.replace(JSON_TOKEN, (m) => {
    if (m.startsWith('"')) return m.endsWith(":") ? `${C.key}${m}${C.reset}` : `${C.string}${m}${C.reset}`;
    if (m === "true" || m === "false") return `${C.boolean}${m}${C.reset}`;
    if (m === "null") return `${C.null}${m}${C.reset}`;
    return `${C.number}${m}${C.reset}`;
  });
}

/** True when output should be human-rendered: a TTY with no explicit --output. */
export function isInteractive(formatExplicit: boolean): boolean {
  return Boolean(process.stdout.isTTY) && !formatExplicit;
}

/**
 * Renders a heading followed by aligned "  Label  value" rows for a flat record.
 * Rows with empty/undefined values are dropped, so callers can list every possible
 * field and only the set ones show. Used by the CLI-authored summary commands
 * (whoami, signup, …) for their human view; scripting still gets the raw object.
 */
export function renderKeyValues(heading: string, rows: Array<[string, string | undefined]>): string {
  const present = rows.filter((r): r is [string, string] => Boolean(r[1]));
  const pad = present.length ? Math.max(...present.map(([k]) => k.length)) : 0;
  return [heading, "", ...present.map(([k, v]) => `  ${k.padEnd(pad)}  ${v}`)].join("\n");
}

export function resolveFormat(requested: string | undefined): OutputFormat {
  if (requested === "json" || requested === "table" || requested === "yaml") return requested;
  if (requested) throw new Error(`Invalid --output value '${requested}'. Use json|table|yaml.`);
  return "table";
}

export function print(data: unknown, format: OutputFormat): void {
  if (data === undefined || data === null) return;
  switch (format) {
    case "json":
      process.stdout.write(colorizeJson(data) + "\n");
      return;
    case "yaml":
      process.stdout.write(yaml.dump(data, {noRefs: true, lineWidth: 120}));
      return;
    case "table":
      process.stdout.write(renderTable(data) + "\n");
      return;
  }
}

/** Shown in place of a value the server left empty, so a blank cell is never ambiguous. */
export const EMPTY_VALUE = "N/A";

/**
 * Width to lay tables out in. `process.stdout.columns` is absent when piped, so a laptop-ish
 * default is used — the point is that a long value wraps onto the next line inside its cell
 * instead of overflowing and breaking the table's borders.
 */
function tableWidth(): number {
  const cols = process.stdout.columns ?? 0;
  return cols > 40 ? Math.min(cols, 160) : 100;
}

function renderTable(data: unknown): string {
  if (Array.isArray(data)) {
    if (data.length === 0) return "(no rows)";
    const first = data[0];
    if (typeof first !== "object" || first === null) {
      return data.map((v) => stripControlChars(String(v))).join("\n");
    }
    const cols = Object.keys(first as object);
    // Split the width evenly, with a floor so a wide row degrades into wrapped cells
    // rather than unreadable slivers.
    const per = Math.max(12, Math.floor((tableWidth() - cols.length - 1) / cols.length));
    const t = new Table({
      head: cols.map(stripControlChars),
      colWidths: cols.map(() => per),
      wordWrap: true,
      // Hard-wrap rather than break on spaces: on word boundaries cli-table3 truncates any
      // token wider than the column, which would silently drop the tail of an id.
      wrapOnWordBoundary: false
    });
    for (const row of data as Array<Record<string, unknown>>) {
      t.push(cols.map((c) => stringify(row[c])));
    }
    return t.toString();
  }
  if (typeof data === "object" && data !== null) {
    const rows = flatten(data as Record<string, unknown>);
    if (rows.length === 0) return "(no fields)";
    const keyWidth = Math.min(Math.max(...rows.map(([k]) => k.length)) + 2, 34);
    const valueWidth = Math.max(20, tableWidth() - keyWidth - 3);
    const t = new Table({colWidths: [keyWidth, valueWidth], wordWrap: true, wrapOnWordBoundary: false});
    for (const [k, v] of rows) {
      t.push({[k]: stringify(v)});
    }
    return t.toString();
  }
  return stripControlChars(String(data));
}

/**
 * Flattens nested objects into dotted keys, so a detail view stays a table of scalars
 * rather than a table with a JSON blob wedged into a single cell. Arrays are left to
 * `stringify` — a cell can't hold a sub-table, and the dotted form would be worse.
 */
function flatten(obj: Record<string, unknown>, prefix = ""): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out.push(...flatten(v as Record<string, unknown>, key));
    } else {
      out.push([key, v]);
    }
  }
  return out;
}

export function stripControlChars(s: string): string {
  // Drop C0 (0x00–0x1F, incl. ESC), DEL (0x7F), and C1 (0x80–0x9F) control chars — code-point
  // loop avoids putting literal control bytes or a no-control-regex in the source.
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0) as number;
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f)) continue;
    out += ch;
  }
  return out;
}

/**
 * Cell text. Anything the server left empty renders as N/A rather than a blank cell — a blank
 * one reads as "the CLI failed to show this" instead of "there is nothing here". Only the table
 * view substitutes; `--output json` keeps the original value so scripting is unaffected.
 */
function stringify(v: unknown): string {
  if (v === null || v === undefined) return EMPTY_VALUE;
  if (Array.isArray(v)) {
    if (v.length === 0) return EMPTY_VALUE;
    // A list of plain values reads far better comma-separated than as a JSON array. Only the
    // table view does this; `--output json` keeps the array, so scripting is unaffected.
    if (v.every((item) => item === null || typeof item !== "object")) {
      return v.map((item) => stripControlChars(String(item))).join(", ");
    }
    return JSON.stringify(v);
  }
  if (typeof v === "object") {
    return Object.keys(v as object).length === 0 ? EMPTY_VALUE : JSON.stringify(v);
  }
  const s = stripControlChars(String(v));
  return s.trim() === "" ? EMPTY_VALUE : s;
}
