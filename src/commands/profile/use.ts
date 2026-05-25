import {defineCommand} from "citty";
import {readConfig, setActiveProfile} from "../../lib/config-store";
import {printError, exitCodeFor, type AtoaError} from "../../lib/errors";
import {LOCAL_DRY_RUN_ARG} from "../_common";

interface UseArgs {
  name?: string;
  dryRun?: boolean;
}

export default defineCommand({
  meta: {name: "use", description: "Set the active profile"},
  args: {
    name: {
      type: "positional",
      required: true,
      description: "profile name (must already exist — run `atoa profile list`)"
    },
    ...LOCAL_DRY_RUN_ARG
  },
  async run({args: cittyArgs}) {
    const args = cittyArgs as unknown as UseArgs;
    try {
      const name = args.name as string;

      if (args.dryRun) {
        const cfg = await readConfig();
        if (!cfg.profiles[name]) {
          process.stdout.write(
            JSON.stringify({action: "use", target: name, error: "profile does not exist"}, null, 2) + "\n"
          );
          return;
        }
        process.stdout.write(
          JSON.stringify({action: "use", from: cfg.activeProfile ?? null, to: name}, null, 2) + "\n"
        );
        return;
      }

      await setActiveProfile(name);
      process.stdout.write(`✓ active profile: ${name}\n`);
    } catch (err) {
      printError(err);
      process.exitCode = exitCodeFor((err as AtoaError).kind);
    }
  }
});
