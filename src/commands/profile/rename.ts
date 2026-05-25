import {defineCommand} from "citty";
import {confirm} from "@inquirer/prompts";
import {readConfig, writeConfig, readProfile} from "../../lib/config-store";
import {createSecretsStore} from "../../lib/secrets-store";
import {printError, exitCodeFor, AtoaError} from "../../lib/errors";
import {LOCAL_DRY_RUN_ARG, LOCAL_YES_ARG} from "../_common";

interface RenameArgs {
  oldName?: string;
  newName?: string;
  yes?: boolean;
  dryRun?: boolean;
}

export default defineCommand({
  meta: {
    name: "rename",
    description: "Rename a profile and move its credentials to the new name."
  },
  args: {
    oldName: {type: "positional", required: true, description: "existing profile name"},
    newName: {type: "positional", required: true, description: "new profile name"},
    ...LOCAL_YES_ARG,
    ...LOCAL_DRY_RUN_ARG
  },
  async run({args: cittyArgs}) {
    const args = cittyArgs as unknown as RenameArgs;
    try {
      const oldName = args.oldName as string;
      const newName = args.newName as string;

      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(newName) || newName.length > 64) {
        throw new AtoaError(
          `profile name "${newName}" is invalid. Use lowercase letters, digits, and single hyphens (e.g. "acme-uk"); max 64 chars.`,
          "validation"
        );
      }

      if (oldName === newName) {
        process.stdout.write(`names are identical — no change\n`);
        return;
      }

      const cfg = await readConfig();
      const existing = await readProfile(oldName);
      if (!existing) throw new AtoaError(`no profile named "${oldName}"`, "not_found");
      if (cfg.profiles?.[newName]) {
        throw new AtoaError(`profile "${newName}" already exists`, "validation");
      }

      const store = await createSecretsStore();
      const [sb, prod] = await Promise.all([store.get(oldName, "sandbox"), store.get(oldName, "production")]);

      if (args.dryRun) {
        const slotsMoved: string[] = [];
        if (sb) slotsMoved.push("sandbox");
        if (prod) slotsMoved.push("production");
        process.stdout.write(
          JSON.stringify(
            {
              action: "rename",
              from: oldName,
              to: newName,
              slotsMoved,
              activeProfileUpdate: cfg.activeProfile === oldName ? `${oldName} → ${newName}` : null
            },
            null,
            2
          ) + "\n"
        );
        return;
      }

      if (!args.yes) {
        const ok = await confirm({
          message: `Rename profile "${oldName}" → "${newName}"? Re-keys ${[sb && "sandbox", prod && "production"].filter(Boolean).join(" + ") || "0"} keychain slot(s).`,
          default: false
        });
        if (!ok) {
          process.stdout.write("Aborted.\n");
          return;
        }
      }

      // Write new slots first; old slots stay valid until step 3.
      if (sb) await store.set(newName, "sandbox", sb);
      if (prod) await store.set(newName, "production", prod);

      // Update config atomically — both rename and activeProfile pointer.
      const nextProfiles = {...(cfg.profiles ?? {})};
      delete nextProfiles[oldName];
      nextProfiles[newName] = existing;
      const nextCfg = {
        ...cfg,
        profiles: nextProfiles,
        ...(cfg.activeProfile === oldName ? {activeProfile: newName} : {})
      };
      await writeConfig(nextCfg);

      // Delete old slots last; failure here leaves both sets live (`atoa whoami`
      // still works under the new name; user can re-run rename or manually
      // run `atoa profile delete <oldName>` to clean up).
      await store.deleteProfile(oldName);

      process.stdout.write(`✓ renamed "${oldName}" → "${newName}"\n`);
    } catch (err) {
      printError(err);
      process.exitCode = exitCodeFor((err as AtoaError).kind);
    }
  }
});
