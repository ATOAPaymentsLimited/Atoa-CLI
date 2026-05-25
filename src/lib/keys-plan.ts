import type {Env, EnvState, ProfileConfig} from "./config-store";

/** Operations that route through the per-type endpoint family. */
export type Action = "revoke" | "regenerate";

export type Plan = {kind: "error"; message: string} | {kind: "execute"; targets: Array<{env: Env; state: EnvState}>};

/**
 * Decides which envs of a profile should be acted on, after enforcing:
 *   1. The profile has at least one configured env.
 *   2. If `--env` was passed, it exists on the profile.
 *   3. Each target env has a known `sdkAccessId`.
 *
 * Whether a key is actually revocable is determined by the API response;
 * the CLI just forwards the request.
 */
export function planAction(profile: ProfileConfig, _action: Action, requestedEnv?: Env): Plan {
  const configured = Object.keys(profile.envs) as Env[];
  if (configured.length === 0) {
    return {kind: "error", message: "no credentials configured for this profile"};
  }

  const targetEnvs = requestedEnv ? [requestedEnv] : configured;

  for (const env of targetEnvs) {
    if (!profile.envs[env]) {
      return {kind: "error", message: `no ${env} credentials for this profile`};
    }
  }

  for (const env of targetEnvs) {
    const state = profile.envs[env]!;
    if (!state.sdkAccessId) {
      return {
        kind: "error",
        message:
          `${env} credentials have no sdkAccessId recorded. Re-paste via \`atoa login\` ` +
          `to refresh the local state, or revoke this key from the dashboard.`
      };
    }
  }

  return {
    kind: "execute",
    targets: targetEnvs.map((env) => ({env, state: profile.envs[env]!}))
  };
}
