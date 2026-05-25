import type {ArgDef, CommandDef} from "citty";
import {readConfig} from "./config-store";

/**
 * Shell completion engine.
 *
 * Design — same shape as `gh`, `kubectl`, `deno`, `bun`:
 *
 *   1. User installs a tiny shell bootstrap (printed by `atoa completion <shell>`).
 *   2. When the user hits TAB, the bootstrap script calls back into the CLI:
 *        atoa --complete-<shell> "<everything on the line>"
 *   3. We walk citty's command tree along the typed words, find the leaf
 *      command, and emit one candidate per line on stdout.
 *
 * The handler MUST NOT touch the keychain, http, or any auth — completion runs
 * on every TAB and has to be ~instant. We resolve lazy `subCommands` thunks
 * only along the path being typed.
 */

export type CompletionShell = "bash" | "zsh" | "pwsh";

/** Common flags that apply to every command via `withCommonArgs` in _common.ts. */
const COMMON_FLAGS = ["env", "output", "verbose", "dryRun", "yes", "profile"] as const;

/**
 * Dynamic resolver: produces candidate strings for a given arg at a given
 * command path. Keys are `"command/subcommand:argName"`; `"*:argName"` is a
 * wildcard used by flags that exist everywhere (e.g. `--profile`).
 *
 * Resolvers are async because they often read the config / state. Errors are
 * swallowed by the engine — completion must never crash the user's shell.
 */
export type CompletionResolver = () => Promise<string[]>;

const resolvers: Record<string, CompletionResolver> = {
  // Static enum-like values
  "*:env": async () => ["sandbox", "production"],
  "*:output": async () => ["json", "table", "yaml"],

  // Dynamic: live profile names from config
  "*:profile": profileNames,
  "profile/use:name": profileNames,
  "profile/show:name": profileNames,
  "profile/rename:name": profileNames,
  "profile/delete:name": profileNames,
  "logout:profile": profileNames,

  // Dynamic: sdkAccessIds attached to the *active* profile's envs.
  // Picked up by `atoa keys revoke <TAB>` / `atoa keys regenerate <TAB>`.
  "keys/revoke:id": activeProfileSdkAccessIds,
  "keys/regenerate:id": activeProfileSdkAccessIds
};

async function profileNames(): Promise<string[]> {
  const cfg = await readConfig();
  return Object.keys(cfg.profiles);
}

async function activeProfileSdkAccessIds(): Promise<string[]> {
  const cfg = await readConfig();
  const seen = new Set<string>();
  for (const p of Object.values(cfg.profiles)) {
    for (const env of Object.values(p.envs)) {
      if (env?.sdkAccessId) seen.add(env.sdkAccessId);
    }
  }
  return [...seen];
}

/**
 * Public entry point used by cli.ts. Parses the partial command line and
 * prints one candidate per line on stdout, then resolves. Never throws —
 * completion must be silent on failure.
 */
export async function handleCompletion(rootCmd: CommandDef, shell: CompletionShell, rawLine: string): Promise<void> {
  try {
    const candidates = await suggest(rootCmd, rawLine);
    if (candidates.length > 0) {
      process.stdout.write(candidates.join(shell === "pwsh" ? "\r\n" : "\n") + "\n");
    }
  } catch {
    // intentional: completion errors must never surface as shell noise
  }
}

/** Visible-for-test: pure-ish, returns the candidates. */
export async function suggest(rootCmd: CommandDef, rawLine: string): Promise<string[]> {
  const words = tokenize(rawLine);
  const endsWithSpace = /\s$/.test(rawLine);
  // First word is the program name itself ("atoa"); drop it.
  if (words[0] === "atoa") words.shift();

  // Walk subCommands along the typed path. `consumed` is the path slice we
  // could resolve; anything after it is either the current incomplete word or
  // already-typed positional args.
  let cmd: CommandDef = rootCmd;
  let pathParts: string[] = [];
  let consumed = 0;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.startsWith("-")) break; // flags don't change the command path
    const subs = await resolveValue(cmd.subCommands);
    if (!subs) break;
    if (subs[w]) {
      cmd = (await resolveValue(subs[w])) as CommandDef;
      pathParts.push(w);
      consumed = i + 1;
    } else {
      // First non-matching positional — could be a typed-out positional value
      // or a half-typed subcommand. Don't keep walking.
      break;
    }
  }

  // Determine "what is the user trying to complete right now?"
  // If the line ends with whitespace, the cursor is at the next word position.
  const tail = endsWithSpace ? "" : (words[words.length - 1] ?? "");
  const expectingNewWord = endsWithSpace || words.length === consumed;

  // The previous token tells us whether we're completing a flag value.
  const prevToken = endsWithSpace ? words[words.length - 1] : words.length >= 2 ? words[words.length - 2] : undefined;

  // Case 1: `... --flag <TAB>` — complete a value for the named flag.
  if (prevToken?.startsWith("--")) {
    const flagName = prevToken.replace(/^--/, "");
    const values = await resolveArgCandidates(pathParts, flagName, cmd);
    return values.filter((v) => v.startsWith(tail));
  }

  // Case 2: tail starts with `--` — complete a flag name from this command's args.
  if (tail.startsWith("--")) {
    const flagNames = flagsFor(cmd).map((f) => "--" + f);
    return flagNames.filter((v) => v.startsWith(tail));
  }

  // Case 3: positional / subcommand.
  const subs = await resolveValue(cmd.subCommands);
  const subNames = subs ? Object.keys(subs) : [];

  // If the command has a positional arg, surface its dynamic candidates.
  const positional = await firstPositionalName(cmd);
  const positionalCandidates = positional ? await resolveArgCandidates(pathParts, positional, cmd) : [];

  const merged = [...subNames, ...positionalCandidates];
  if (expectingNewWord && tail === "") return merged;
  return merged.filter((v) => v.startsWith(tail));
}

async function resolveArgCandidates(pathParts: string[], argName: string, cmd: CommandDef): Promise<string[]> {
  // Path-scoped resolver wins over wildcard.
  const pathKey = `${pathParts.join("/")}:${argName}`;
  const wildKey = `*:${argName}`;
  const resolver = resolvers[pathKey] ?? resolvers[wildKey];
  if (resolver) {
    try {
      return await resolver();
    } catch {
      return [];
    }
  }

  // Static fallback: citty enum options.
  const args = (await resolveValue(cmd.args)) as Record<string, ArgDef> | undefined;
  const def = args?.[argName] as (ArgDef & {options?: string[]}) | undefined;
  if (def?.options) return def.options;
  return [];
}

async function firstPositionalName(cmd: CommandDef): Promise<string | undefined> {
  const args = (await resolveValue(cmd.args)) as Record<string, ArgDef> | undefined;
  if (!args) return undefined;
  for (const [name, def] of Object.entries(args)) {
    if (def.type === "positional") return name;
  }
  return undefined;
}

function flagsFor(cmd: CommandDef): string[] {
  const own =
    cmd.args && typeof cmd.args === "object"
      ? Object.entries(cmd.args as Record<string, ArgDef>)
          .filter(([, def]) => def.type !== "positional")
          .map(([name]) => name)
      : [];
  return Array.from(new Set([...own, ...COMMON_FLAGS]));
}

async function resolveValue<T>(v: T | Promise<T> | (() => T | Promise<T>) | undefined): Promise<T | undefined> {
  if (v === undefined) return undefined;
  const r = typeof v === "function" ? (v as () => T | Promise<T>)() : v;
  return await r;
}

/**
 * Minimal tokenizer — splits on whitespace honouring single + double quoted
 * sections. Sufficient for shell-completion input where users rarely paste
 * complex quoting before hitting TAB.
 */
function tokenize(line: string): string[] {
  const out: string[] = [];
  let buf = "";
  let quote: '"' | "'" | null = null;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else buf += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (buf) {
        out.push(buf);
        buf = "";
      }
    } else {
      buf += ch;
    }
  }
  if (buf) out.push(buf);
  return out;
}

/**
 * Shell-specific bootstrap printed by `atoa completion <shell>`. Each
 * registers a completion function that defers to the CLI for candidates.
 */
export function completionScript(shell: CompletionShell): string {
  switch (shell) {
    case "bash":
      return BASH_SCRIPT;
    case "zsh":
      return ZSH_SCRIPT;
    case "pwsh":
      return PWSH_SCRIPT;
  }
}

const BASH_SCRIPT = `# atoa bash completion. Install: atoa completion bash >> ~/.bashrc && source ~/.bashrc
_atoa_complete() {
  local cur line
  cur="\${COMP_WORDS[COMP_CWORD]}"
  line="\${COMP_LINE}"
  COMPREPLY=( $(compgen -W "$(atoa --complete-bash "$line" 2>/dev/null)" -- "$cur") )
  return 0
}
complete -F _atoa_complete atoa
`;

const ZSH_SCRIPT = `# atoa zsh completion. Install: atoa completion zsh > ~/.zsh/completions/_atoa
#fpath=(~/.zsh/completions $fpath)  # add to your .zshrc above 'autoload -Uz compinit && compinit'
#compdef atoa
_atoa() {
  local -a candidates
  local line="\${(j: :)words[@]}"
  candidates=("\${(@f)$(atoa --complete-zsh "$line" 2>/dev/null)}")
  compadd -- $candidates
}
_atoa "$@"
`;

const PWSH_SCRIPT = `# atoa PowerShell completion. Install: atoa completion pwsh | Out-String | Invoke-Expression
# Add to your $PROFILE to persist across sessions.
Register-ArgumentCompleter -Native -CommandName atoa -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)
    $line = $commandAst.ToString()
    if (-not $wordToComplete) { $line = "$line " }
    & atoa --complete-pwsh "$line" 2>$null | ForEach-Object {
        [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
}
`;
