import messages from "../locales/en.json";

type Messages = typeof messages;

/**
 * Fills `{name}` placeholders in a message from `locales/en.json`.
 *
 * Interpolated rather than concatenated so the whole sentence — including word order and
 * punctuation — stays in the locale file, where a translator can reach it.
 */
export function t<K extends keyof Messages>(key: K, params?: Record<string, string | number>): string {
  const template = messages[key] as string;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/** Direct access for messages with no placeholders. */
export default messages;
