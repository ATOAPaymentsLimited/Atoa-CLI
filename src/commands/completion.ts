import {defineCommand} from "citty";
import {completionScript, type CompletionShell} from "../lib/completion";

const SHELLS: readonly CompletionShell[] = ["bash", "zsh", "pwsh"] as const;

export default defineCommand({
  meta: {
    name: "completion",
    description:
      "Print the shell-completion bootstrap for bash | zsh | pwsh. Source the output to enable TAB-completion of atoa commands and flags."
  },
  args: {
    shell: {
      type: "positional",
      required: true,
      description: "target shell (bash | zsh | pwsh)"
    }
  },
  run({args}) {
    const shell = String(args.shell).toLowerCase() as CompletionShell;
    if (!SHELLS.includes(shell)) {
      process.stderr.write(`error: unsupported shell "${args.shell}". Supported: ${SHELLS.join(", ")}.\n`);
      process.exitCode = 3;
      return;
    }
    process.stdout.write(completionScript(shell));
  }
});
