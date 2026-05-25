import {defineCommand} from "citty";
import {confirm, select} from "@inquirer/prompts";
import {withCommonArgs, runWithContext, isFlagPassed, type CommonOptions} from "../_common";
import type {CommandContext} from "../../lib/context";
import {deleteProfile as deleteProfileEntry, readProfile, writeProfile, type Env} from "../../lib/config-store";
import {createSecretsStore} from "../../lib/secrets-store";
import {planAction} from "../../lib/keys-plan";
import {AtoaError} from "../../lib/errors";

type RevokeArgs = CommonOptions & {id?: string};

export default defineCommand({
  meta: {
    name: "revoke",
    description:
      "Revoke one SDK key for the active profile. Picks the env interactively when the profile has both — pass --env to skip the prompt."
  },
  args: withCommonArgs({
    id: {
      type: "positional",
      required: false,
      description:
        "sdkAccessId to revoke (overrides the profile lookup; only that one key is revoked, local state untouched)"
    }
  }),
  run: runWithContext<RevokeArgs>(async (ctx, args, rawArgs) => {
    const explicitId = (args.id as string | undefined)?.trim();
    const explicitEnv: Env | undefined = isFlagPassed(rawArgs, "--env") ? ctx.env : undefined;

    const target = explicitId
      ? {env: explicitEnv ?? ctx.profile.defaultEnv ?? ("sandbox" as Env), sdkAccessId: explicitId, fromProfile: false}
      : await resolveTargetFromProfile(ctx, explicitEnv);

    if (!ctx.yes) {
      const message = target.fromProfile
        ? `Revoke the ${target.env} SDK key "${target.sdkAccessId}" and clear local credentials for profile "${ctx.profileName}"?\n` +
          `This is immediate and not recoverable.`
        : `Revoke SDK key "${target.sdkAccessId}"?\n` + `This is immediate and not recoverable.`;
      const ok = await confirm({message});
      if (!ok) {
        process.stdout.write("Aborted.\n");
        return;
      }
    }

    if (ctx.dryRun) {
      ctx.print({
        method: "DELETE",
        path: `/api/cli/api-access/${target.sdkAccessId}`,
        env: target.env
      });
      return;
    }

    await ctx.http.request({
      method: "DELETE",
      path: "/api/cli/api-access/:sdkAccessId",
      pathParams: {sdkAccessId: target.sdkAccessId}
    });

    if (target.fromProfile) {
      await clearLocalForRevoke(ctx.profileName, target.env);
    }

    ctx.print({
      profile: target.fromProfile ? ctx.profileName : undefined,
      env: target.fromProfile ? target.env : undefined,
      sdkAccessId: target.sdkAccessId,
      revoked: true
    });
  })
});

/**
 * Picks the single (env, sdkAccessId) pair to revoke, asking the user when
 * the profile has both envs. Honours `--env` as the explicit override.
 * Non-TTY callers without `--env` get a clear error rather than a hanging
 * prompt.
 */
async function resolveTargetFromProfile(
  ctx: CommandContext,
  explicitEnv: Env | undefined
): Promise<{env: Env; sdkAccessId: string; fromProfile: true}> {
  const plan = planAction(ctx.profile, "revoke");
  if (plan.kind === "error") throw new AtoaError(plan.message, "validation");

  const env = await pickEnv(ctx, explicitEnv);
  const state = ctx.profile.envs[env];
  if (!state?.sdkAccessId) {
    throw new AtoaError(
      `no ${env} key recorded for profile "${ctx.profileName}". Re-paste via \`atoa login --env ${env}\`.`,
      "validation"
    );
  }
  return {env, sdkAccessId: state.sdkAccessId, fromProfile: true};
}

async function pickEnv(ctx: CommandContext, explicitEnv: Env | undefined): Promise<Env> {
  if (explicitEnv) return explicitEnv;

  const configured = (["sandbox", "production"] as Env[]).filter((e) => ctx.profile.envs[e]);
  if (configured.length === 1) return configured[0];

  if (!process.stdin.isTTY) {
    throw new AtoaError(
      `profile "${ctx.profileName}" has both sandbox and production keys — pass --env=sandbox|production to scope.`,
      "validation"
    );
  }

  return await select({
    message: `Profile "${ctx.profileName}" has both envs — select which key to revoke:`,
    choices: [
      {value: "sandbox", name: "sandbox"},
      {value: "production", name: "production"}
    ],
    default: ctx.profile.defaultEnv ?? "sandbox"
  });
}

/**
 * Drop the keychain slot + per-env profile entry for the revoked env. If
 * that was the only env, delete the profile entry entirely so we don't
 * leave an orphan record claiming credentials exist.
 */
async function clearLocalForRevoke(profileName: string, env: Env): Promise<void> {
  const store = await createSecretsStore();
  await store.delete(profileName, env);

  const profile = await readProfile(profileName);
  if (!profile) {
    process.stdout.write(`✓ cleared local ${env} credentials for "${profileName}"\n`);
    return;
  }

  const nextEnvs = {...profile.envs};
  delete nextEnvs[env];

  if (Object.keys(nextEnvs).length === 0) {
    await store.deleteProfile(profileName);
    await deleteProfileEntry(profileName);
    process.stdout.write(`✓ cleared local ${env} credentials and removed empty profile "${profileName}"\n`);
    return;
  }

  await writeProfile(profileName, {...profile, envs: nextEnvs});
  process.stdout.write(`✓ cleared local ${env} credentials for "${profileName}" (other env preserved)\n`);
}
