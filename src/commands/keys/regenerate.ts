import {defineCommand} from "citty";
import {confirm, select} from "@inquirer/prompts";
import {withCommonArgs, runWithContext, isFlagPassed, type CommonOptions} from "../_common";
import type {CommandContext} from "../../lib/context";
import {createSecretsStore} from "../../lib/secrets-store";
import {readProfile, writeProfile, type Env, type EnvState} from "../../lib/config-store";
import {fingerprintToken} from "../../lib/auth";
import {planAction} from "../../lib/keys-plan";
import {AtoaError} from "../../lib/errors";

type RegenArgs = CommonOptions & {id?: string};

interface SdkAccessRegenResponse {
  sandboxApiSecret?: string;
  productionApiSecret?: string;
  apiSecret?: string;
}

export default defineCommand({
  meta: {
    name: "regenerate",
    description:
      "Rotate one SDK key for the active profile. Picks the env interactively when the profile has both — pass --env to skip the prompt. New bearer is shown ONCE."
  },
  args: withCommonArgs({
    id: {
      type: "positional",
      required: false,
      description: "sdkAccessId to rotate (overrides the profile lookup; only that one key is rotated)"
    }
  }),
  run: runWithContext<RegenArgs>(async (ctx, args, rawArgs) => {
    const explicitId = (args.id as string | undefined)?.trim();
    const explicitEnv: Env | undefined = isFlagPassed(rawArgs, "--env") ? ctx.env : undefined;

    const target = explicitId
      ? {env: explicitEnv ?? ctx.profile.defaultEnv ?? ("sandbox" as Env), sdkAccessId: explicitId, fromProfile: false}
      : await resolveTargetFromProfile(ctx, explicitEnv);

    if (!ctx.yes) {
      const ok = await confirm({
        message:
          `Rotate the ${target.env} SDK key "${target.sdkAccessId}" for profile "${ctx.profileName}"?\n` +
          `The old token stops working immediately. The new bearer is shown ONCE.`
      });
      if (!ok) {
        process.stdout.write("Aborted.\n");
        return;
      }
    }

    const request = {
      method: "POST" as const,
      path: "/api/cli/api-access/:sdkAccessId/regenerate",
      pathParams: {sdkAccessId: target.sdkAccessId}
    };

    if (ctx.dryRun) {
      ctx.print({...request, env: target.env});
      return;
    }

    const {data} = await ctx.http.request(request);
    const token = extractBearer(data, target.env);
    if (!token) {
      throw new AtoaError("server response did not include a new apiSecret — nothing to store", "generic");
    }

    let stored = false;
    if (target.fromProfile) {
      await persistRotatedToken(ctx.profileName, target.sdkAccessId, target.env, token);
      stored = true;
    }

    ctx.print({
      profile: ctx.profileName,
      env: target.env,
      sdkAccessId: target.sdkAccessId,
      token,
      fingerprint: `…${token.slice(-4)}`,
      storedLocally: stored
    });

    process.stderr.write(
      "warning: this token is shown ONCE. Save it now if you need to copy it elsewhere (CI, another machine, …).\n"
    );
  })
});

/**
 * Picks the single (env, sdkAccessId) pair to operate on, asking the user to
 * choose between sandbox and production when the profile has both. Honours
 * `--env` as the explicit override. Non-TTY callers without `--env` get a
 * clear error rather than a hanging prompt.
 */
async function resolveTargetFromProfile(
  ctx: CommandContext,
  explicitEnv: Env | undefined
): Promise<{env: Env; sdkAccessId: string; fromProfile: true}> {
  const plan = planAction(ctx.profile, "regenerate");
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
    message: `Profile "${ctx.profileName}" has both envs — select which key to rotate:`,
    choices: [
      {value: "sandbox", name: "sandbox"},
      {value: "production", name: "production"}
    ],
    default: ctx.profile.defaultEnv ?? "sandbox"
  });
}

function extractBearer(data: unknown, env: Env): string | undefined {
  const row = (data ?? {}) as SdkAccessRegenResponse;
  if (env === "sandbox") return row.sandboxApiSecret ?? row.apiSecret;
  if (env === "production") return row.productionApiSecret ?? row.apiSecret;
  return row.apiSecret;
}

/**
 * Persist the rotated token to the keychain and refresh the profile's
 * per-env state so the fingerprint stays in sync with what's stored.
 */
async function persistRotatedToken(profileName: string, sdkAccessId: string, env: Env, token: string): Promise<void> {
  const store = await createSecretsStore();
  await store.set(profileName, env, token);

  const refreshed = await readProfile(profileName);
  if (refreshed) {
    const nextState: EnvState = {
      sdkAccessId,
      tokenFingerprint: fingerprintToken(token)
    };
    await writeProfile(profileName, {
      ...refreshed,
      envs: {...refreshed.envs, [env]: nextState}
    });
  }
}
