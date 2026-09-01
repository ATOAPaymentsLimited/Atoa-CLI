import {describe, it, expect, vi, beforeEach} from "vitest";

vi.mock("@inquirer/prompts", () => ({
  input: vi.fn(async () => "")
}));

import {resolveField} from "../../src/lib/prompt-field";
import {AtoaError} from "../../src/lib/errors";
import * as prompts from "@inquirer/prompts";

/** Tolerates an empty answer — what a future rule could plausibly look like. */
const acceptsAnything = () => true as const;
const rejectsEmpty = (v: string) => (v.trim() ? true : "required");

describe("resolveField — a required field resolves to a string or throws", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * The overload promises `Promise<string>` for a required field, but the body ends
   * `return answer || undefined`. That was sound only because every rule currently used for a
   * required field rejects "" — a convention the compiler does not enforce. Callers rely on the
   * promise: signup does `(await resolveField({...})).toUpperCase()`, which would throw on
   * undefined with a green typecheck.
   */
  it("throws rather than returning undefined when the rule tolerates an empty answer", async () => {
    vi.mocked(prompts.input).mockResolvedValueOnce("   ");

    await expect(
      resolveField({
        value: undefined,
        flag: "postal-code",
        message: "Postcode:",
        rule: acceptsAnything,
        interactive: true
      })
    ).rejects.toBeInstanceOf(AtoaError);
  });

  it("names the flag so the caller knows what is missing", async () => {
    vi.mocked(prompts.input).mockResolvedValueOnce("");

    await expect(
      resolveField({
        value: undefined,
        flag: "postal-code",
        message: "Postcode:",
        rule: acceptsAnything,
        interactive: true
      })
    ).rejects.toThrow(/postal-code/);
  });

  it("exits 3, not 1 — a missing value is bad input, not a server fault", async () => {
    vi.mocked(prompts.input).mockResolvedValueOnce("");

    // `rejects`, not `.catch()`: a catch block that never runs is a test that always passes.
    await expect(
      resolveField({
        value: undefined,
        flag: "postal-code",
        message: "Postcode:",
        rule: acceptsAnything,
        interactive: true
      })
    ).rejects.toMatchObject({kind: "validation"});
  });

  it("still returns undefined for an optional field left blank", async () => {
    vi.mocked(prompts.input).mockResolvedValueOnce("");

    const result = await resolveField({
      value: undefined,
      flag: "address-line2",
      message: "Address line 2:",
      rule: acceptsAnything,
      interactive: true,
      optional: true
    });

    expect(result).toBeUndefined();
  });

  it("returns the answer untouched when one is given", async () => {
    vi.mocked(prompts.input).mockResolvedValueOnce("  SW1A 1AA  ");

    const result = await resolveField({
      value: undefined,
      flag: "postal-code",
      message: "Postcode:",
      rule: rejectsEmpty,
      interactive: true
    });

    expect(result).toBe("SW1A 1AA");
  });

  it("takes a valid flag value without prompting at all", async () => {
    const result = await resolveField({
      value: "SW1A 1AA",
      flag: "postal-code",
      message: "Postcode:",
      rule: rejectsEmpty,
      interactive: true
    });

    expect(result).toBe("SW1A 1AA");
    expect(prompts.input).not.toHaveBeenCalled();
  });
});
