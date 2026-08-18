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
 */
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
