/**
 * Output formatting: --output json | table | yaml.
 *
 * Default: json. `resolveFormat(undefined)` returns "json" unconditionally —
 * machines and humans both get JSON unless they ask for table/yaml. Errors
 * always go to stderr; data always to stdout.
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
  return "json";
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

function renderTable(data: unknown): string {
  if (Array.isArray(data)) {
    if (data.length === 0) return "(no rows)";
    const first = data[0];
    if (typeof first !== "object" || first === null) {
      return data.map((v) => String(v)).join("\n");
    }
    const cols = Object.keys(first as object);
    const t = new Table({head: cols});
    for (const row of data as Array<Record<string, unknown>>) {
      t.push(cols.map((c) => stringify(row[c])));
    }
    return t.toString();
  }
  if (typeof data === "object" && data !== null) {
    const t = new Table();
    for (const [k, v] of Object.entries(data)) {
      t.push({[k]: stringify(v)});
    }
    return t.toString();
  }
  return String(data);
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
