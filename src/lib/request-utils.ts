import {readFile} from "fs/promises";

export function parseFieldArgs(rawArgs: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < rawArgs.length - 1; i++) {
    if (rawArgs[i] === "-d") {
      const kv = rawArgs[i + 1];
      const eq = typeof kv === "string" ? kv.indexOf("=") : -1;
      if (eq > 0) result[kv.slice(0, eq)] = kv.slice(eq + 1);
    }
  }
  return result;
}

export function resolvePathAndQuery(
  path: string,
  data: Record<string, string>
): {resolvedPath: string; query: Record<string, string>} {
  let resolvedPath = path;
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    if (resolvedPath.includes(`:${k}`)) {
      resolvedPath = resolvedPath.replace(`:${k}`, encodeURIComponent(v));
    } else {
      query[k] = v;
    }
  }
  return {resolvedPath, query};
}

export async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c: string) => (data += c));
    process.stdin.on("end", () => resolve(data.trim()));
    process.stdin.on("error", reject);
  });
}

export async function resolveBody(data: string | undefined, fields: Record<string, string>): Promise<unknown> {
  if (data?.startsWith("@")) {
    return JSON.parse(await readFile(data.slice(1), "utf8"));
  }
  if (data === "-") {
    return JSON.parse(await readStdin());
  }
  if (Object.keys(fields).length > 0) {
    return Object.fromEntries(
      Object.entries(fields).map(([k, v]) => {
        if (v === "true") return [k, true];
        if (v === "false") return [k, false];
        const n = Number(v);
        return [k, !isNaN(n) && v !== "" ? n : v];
      })
    );
  }
  return undefined;
}
