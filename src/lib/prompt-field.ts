import {AtoaError} from "./errors";
import {t} from "./i18n";

export type FieldRule = (value: string) => true | string;

export interface ResolveFieldOptions {
  /** Value supplied via flag, if any. */
  value: string | undefined;
  /** Flag name without dashes, used in error text (e.g. "location-name"). */
  flag: string;
  /** Prompt label shown on a TTY. */
  message: string;
  rule: FieldRule;
  interactive: boolean;
  optional?: boolean;
  /** Pre-filled answer offered at the prompt. */
  default?: string;
}

/**
 * Resolves one field from a flag or a prompt, validating both the same way. An invalid flag is
 * re-asked on a TTY rather than aborting; with nobody to ask it fails instead of hanging.
 *
 * A required field either returns a value or throws, so it resolves to `string` — callers don't
 * need a follow-up emptiness check that can never fire.
 */
export async function resolveField(opts: ResolveFieldOptions & {optional?: false}): Promise<string>;
export async function resolveField(opts: ResolveFieldOptions & {optional: true}): Promise<string | undefined>;
// Callers that decide `optional` at runtime get the union, as before.
export async function resolveField(opts: ResolveFieldOptions): Promise<string | undefined>;
export async function resolveField(opts: ResolveFieldOptions): Promise<string | undefined> {
  const supplied = opts.value?.trim();

  if (supplied) {
    const verdict = opts.rule(supplied);
    if (verdict === true) return supplied;
    const message = t("flagInvalid", {flag: opts.flag, reason: verdict});
    if (!opts.interactive) throw new AtoaError(message, "validation");
    process.stderr.write(`${message}\n`);
  } else if (!opts.interactive) {
    if (opts.optional) return undefined;
    throw new AtoaError(t("flagRequired", {flag: opts.flag}), "validation");
  }

  const {input} = await import("@inquirer/prompts");
  const answer = (
    await input({
      message: opts.message,
      default: opts.default,
      validate: (v) => (opts.optional && !v.trim() ? true : opts.rule(v))
    })
  ).trim();
  return answer || undefined;
}

export interface ResolveChoiceOptions {
  /** Value supplied via flag — matched against a choice's id first, then its name. */
  value: string | undefined;
  flag: string;
  message: string;
  choices: Array<{value: string; name: string}>;
  interactive: boolean;
  optional?: boolean;
  /** Type-to-filter rather than a plain list — for sets too long to scroll. */
  searchable?: boolean;
}

/**
 * The choice-field counterpart of resolveField. The options come from the server, so a caller
 * scripting this can't know the ids: a flag may name a choice instead, and an unmatched value
 * fails listing what was valid rather than silently picking something.
 */
export async function resolveChoice(opts: ResolveChoiceOptions): Promise<string | undefined> {
  // Checked first: with nothing to choose from there is no answer to demand, and the "required"
  // error below would otherwise list an empty set of valid options.
  if (!opts.choices.length) return undefined;

  const supplied = opts.value?.trim();

  if (supplied) {
    const lower = supplied.toLowerCase();
    const hit =
      opts.choices.find((c) => c.value === supplied) ??
      opts.choices.find((c) => c.name.toLowerCase() === lower) ??
      onlyOne(opts.choices.filter((c) => c.name.toLowerCase().includes(lower)));
    if (hit) return hit.value;

    const message = t("flagNoMatch", {
      flag: opts.flag,
      value: supplied,
      options: opts.choices.map((c) => c.name).join(", ")
    });
    if (!opts.interactive) throw new AtoaError(message, "validation");
    process.stderr.write(`${message}\n`);
  } else if (!opts.interactive) {
    if (opts.optional) return undefined;
    throw new AtoaError(
      t("flagRequiredWithOptions", {flag: opts.flag, options: opts.choices.map((c) => c.name).join(", ")}),
      "validation"
    );
  }

  if (opts.searchable) {
    const {search} = await import("@inquirer/prompts");
    return search({
      message: opts.message,
      source: (term) => {
        const q = (term ?? "").toLowerCase();
        return opts.choices
          .filter((c) => c.name.toLowerCase().includes(q))
          .map((c) => ({value: c.value, name: c.name}));
      }
    }) as Promise<string>;
  }
  const {select} = await import("@inquirer/prompts");
  return select({message: opts.message, choices: opts.choices});
}

/** A filter result is only usable when it is unambiguous — two partial hits is not a choice. */
function onlyOne<T>(matches: T[]): T | undefined {
  return matches.length === 1 ? matches[0] : undefined;
}
