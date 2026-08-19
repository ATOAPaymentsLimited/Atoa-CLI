import {describe, it, expect, vi} from "vitest";
import {resolveFormat, print, stripControlChars} from "../../src/lib/output";

describe("stripControlChars", () => {
  it("strips ANSI/OSC escape introducers and other control chars from server data", () => {
    const ESC = String.fromCharCode(27); // 0x1b
    const BEL = String.fromCharCode(7); // 0x07
    const NUL = String.fromCharCode(0); // 0x00
    const evil = ESC + "[2K" + ESC + "[1AInjected" + BEL + " name" + NUL;
    expect(evil).not.toBe(stripControlChars(evil)); // sanity: input really had control chars
    // ESC/BEL/NUL removed; the now-inert bracket text remains as literal characters.
    expect(stripControlChars(evil)).toBe("[2K[1AInjected name");
  });

  it("leaves ordinary text (including unicode) untouched", () => {
    expect(stripControlChars("Acme Café £10")).toBe("Acme Café £10");
  });
});

describe("resolveFormat", () => {
  it("accepts json", () => expect(resolveFormat("json")).toBe("json"));
  it("accepts table", () => expect(resolveFormat("table")).toBe("table"));
  it("accepts yaml", () => expect(resolveFormat("yaml")).toBe("yaml"));
  it("rejects unknown value", () => expect(() => resolveFormat("xml")).toThrow());
  // Table, not JSON — a raw JSON dump is not a readable answer to `atoa stores list`.
  // Scripts opt into `--output json`; the default is the human view regardless of TTY.
  it("defaults to table when no --output is given", () => {
    for (const isTTY of [true, false]) {
      const orig = process.stdout.isTTY;
      Object.defineProperty(process.stdout, "isTTY", {value: isTTY, configurable: true});
      expect(resolveFormat(undefined)).toBe("table");
      Object.defineProperty(process.stdout, "isTTY", {value: orig, configurable: true});
    }
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
