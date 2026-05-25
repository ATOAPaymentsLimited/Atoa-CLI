import {describe, it, expect} from "vitest";
import {parseFieldArgs, resolvePathAndQuery, resolveBody} from "../../src/lib/request-utils";

describe("parseFieldArgs", () => {
  it("extracts -d key=value pairs", () => {
    expect(parseFieldArgs(["-d", "foo=bar", "-d", "n=42"])).toEqual({foo: "bar", n: "42"});
  });

  it("returns empty object when no -d flags", () => {
    expect(parseFieldArgs(["get", "/path"])).toEqual({});
  });

  it("ignores malformed entries without =", () => {
    expect(parseFieldArgs(["-d", "noequals"])).toEqual({});
  });
});

describe("resolvePathAndQuery", () => {
  it("substitutes :param in path from data", () => {
    const {resolvedPath, query} = resolvePathAndQuery("/api/:id", {id: "abc", env: "sandbox"});
    expect(resolvedPath).toBe("/api/abc");
    expect(query).toEqual({env: "sandbox"});
  });

  it("puts all data in query when no path params", () => {
    const {resolvedPath, query} = resolvePathAndQuery("/api/list", {page: "1"});
    expect(resolvedPath).toBe("/api/list");
    expect(query).toEqual({page: "1"});
  });

  it("URL-encodes substituted values", () => {
    const {resolvedPath} = resolvePathAndQuery("/api/:id", {id: "a b"});
    expect(resolvedPath).toBe("/api/a%20b");
  });
});

describe("resolveBody", () => {
  it("returns undefined when no data and no fields", async () => {
    expect(await resolveBody(undefined, {})).toBeUndefined();
  });

  it("builds object from fields with type coercion", async () => {
    const body = (await resolveBody(undefined, {amount: "100", active: "true", name: "test"})) as any;
    expect(body.amount).toBe(100);
    expect(body.active).toBe(true);
    expect(body.name).toBe("test");
  });

  it("fields take precedence when no --data flag", async () => {
    const body = await resolveBody(undefined, {key: "val"});
    expect(body).toEqual({key: "val"});
  });
});
