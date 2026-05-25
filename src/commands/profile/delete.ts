import {defineCommand} from "citty";
import {confirm} from "@inquirer/prompts";
import {deleteProfile as deleteProfileEntry, readProfile} from "../../lib/config-store";
import {createSecretsStore} from "../../lib/secrets-store";
import {printError, exitCodeFor, AtoaError} from "../../lib/errors";
import {LOCAL_DRY_RUN_ARG, LOCAL_YES_ARG} from "../_common";

interface DeleteArgs {
  name?: string;
  yes?: boolean;
  dryRun?: boolean;
}

export default defineCommand({
  meta: {name: "delete", description: "Delete a profile (config entry + both secret slots)"},
  args: {
    name: {type: "positional", required: true, description: "profile name"},
    ...LOCAL_YES_ARG,
    ...LOCAL_DRY_RUN_ARG
  },
  async run({args: cittyArgs}) {
    const args = cittyArgs as unknown as DeleteArgs;
    try {
      const name = args.name as string;
      const existing = await readProfile(name);

      if (args.dryRun) {
        if (!existing) {
          process.stdout.write(
            JSON.stringify(
              {action: "delete", profile: name, configEntry: "absent", note: "would scrub any orphaned secret slots"},
              null,
              2
            ) + "\n"
          );
          return;
        }
        process.stdout.write(
          JSON.stringify(
            {
              action: "delete",
              profile: name,
              willRemoveConfigEntry: true,
              willRemoveSlots: Object.keys(existing.envs ?? {})
            },
            null,
            2
          ) + "\n"
        );
        return;
      }

      if (!existing) {
        // Still try to scrub orphaned secret slots — they may exist without a
        // config entry if a previous rename/migration only half-completed.
        const store = await createSecretsStore();
        await store.deleteProfile(name);
        process.stdout.write(`no config entry for "${name}" (scrubbed any orphaned secret slots)\n`);
        return;
      }

      if (!args.yes) {
        const ok = await confirm({
          message: `Delete profile "${name}"? This removes its config entry and both secret slots.`
        });
        if (!ok) {
          process.stdout.write("Aborted.\n");
          return;
        }
      }

      const store = await createSecretsStore();
      await store.deleteProfile(name);
      await deleteProfileEntry(name);
      process.stdout.write(`✓ deleted profile "${name}"\n`);
    } catch (err) {
      printError(err);
      process.exitCode = exitCodeFor((err as AtoaError).kind);
    }
  }
});
