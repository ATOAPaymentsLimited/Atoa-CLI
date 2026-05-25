import {describe, it, expect, vi} from "vitest";
import {resolveFormat, print} from "../../src/lib/output";

describe("resolveFormat", () => {
  it("accepts json", () => expect(resolveFormat("json")).toBe("json"));
  it("accepts table", () => expect(resolveFormat("table")).toBe("table"));
  it("accepts yaml", () => expect(resolveFormat("yaml")).toBe("yaml"));
  it("rejects unknown value", () => expect(() => resolveFormat("xml")).toThrow());
  it("defaults to json when stdout is not a TTY", () => {
    const orig = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", {value: false, configurable: true});
    expect(resolveFormat(undefined)).toBe("json");
    Object.defineProperty(process.stdout, "isTTY", {value: orig, configurable: true});
  });
});

describe("print", () => {
  it("writes JSON to stdout", () => {
    const spy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    print({a: 1}, "json");
    expect(spy.mock.calls.map((c) => String(c[0])).join("")).toContain('"a": 1');
    spy.mockRestore();
  });

  it("writes YAML to stdout", () => {
    const spy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    print({a: 1}, "yaml");
    expect(spy.mock.calls.map((c) => String(c[0])).join("")).toContain("a: 1");
    spy.mockRestore();
  });

  it("renders a table for an array of objects", () => {
    const spy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    print([{id: "1", name: "x"}], "table");
    const out = spy.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toContain("id");
    expect(out).toContain("name");
    spy.mockRestore();
  });

  it("renders (no rows) for empty array in table mode", () => {
    const spy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    print([], "table");
    expect(spy.mock.calls.map((c) => String(c[0])).join("")).toContain("no rows");
    spy.mockRestore();
  });

  it("skips null/undefined", () => {
    const spy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    print(null, "json");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
