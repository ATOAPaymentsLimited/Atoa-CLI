import {AtoaError} from "./errors";

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
 * Resolves one input field against a validation rule.
 *
 * A valid flag value is taken as-is. An invalid one is reported and then re-asked on a TTY —
 * @inquirer's `validate` keeps the prompt open, printing the reason under it, until the answer
 * passes. With nobody to ask (piped, or an explicit --output), it fails instead of hanging.
 */
export async function resolveField(opts: ResolveFieldOptions): Promise<string | undefined> {
  const supplied = opts.value?.trim();

  if (supplied) {
    const verdict = opts.rule(supplied);
    if (verdict === true) return supplied;
    if (!opts.interactive) throw new AtoaError(`--${opts.flag}: ${verdict}`, "validation");
    process.stderr.write(`--${opts.flag}: ${verdict}\n`);
  } else if (!opts.interactive) {
    if (opts.optional) return undefined;
    throw new AtoaError(`--${opts.flag} is required`, "validation");
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
