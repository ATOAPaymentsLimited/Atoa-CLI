import {defineCommand} from "citty";
import {password, select} from "@inquirer/prompts";
import {parseEnvFlag, resolveBaseUrl, type Env} from "../lib/env";
import {buildAuthHeader, fingerprintToken} from "../lib/auth";
import {buildHttpClient, assertTlsHardenedEnv} from "../lib/http";
import {createSecretsStore} from "../lib/secrets-store";
import {
  readConfig,
  writeConfig,
  writeProfile,
  readProfile,
  deriveProfileName,
  newProfile,
  type EnvState
} from "../lib/config-store";
import {AtoaError, printError, exitCodeFor} from "../lib/errors";
import {readStdin} from "../lib/request-utils";

interface CliIdentity {
  merchantId: string;
  businessName: string;
  /**
   * Metadata about the API key that authenticated this /identity call.
   * `env` is returned as 'SANDBOX' | 'PRODUCTION' (uppercase).
   */
  key?: {
    sdkAccessId: string;
    env: string;
    keyType: string;
  };
}

export default defineCommand({
  meta: {
    name: "login",
    description: "Log in to an Atoa merchant account with an API key"
  },
  args: {
    env: {type: "string", description: "sandbox|production (skips the interactive prompt when supplied)"},
    stdin: {type: "boolean", description: "read token from stdin instead of prompting (for scripts/CI)"},
    profile: {
      type: "string",
      description: "profile name to store credentials under (defaults to slugified business name)"
    }
  },
  async run({args}) {
    try {
      assertTlsHardenedEnv();
      await pasteFlow(args);
    } catch (err) {
      printError(err);
      process.exitCode = exitCodeFor((err as AtoaError).kind);
    }
  }
});

async function pasteFlow(args: {env?: string; stdin?: boolean; profile?: string}): Promise<void> {
  const env: Env = await resolveEnv(args);

  const raw = args.stdin ? await readStdin() : await password({message: `Paste API token for ${env}:`, mask: "*"});
  const token = raw.trim();
  if (!token) throw new AtoaError("token cannot be empty", "validation");

  const baseUrl = resolveBaseUrl();
  const http = buildHttpClient({
    baseUrl,
    authHeader: buildAuthHeader(token),
    verbose: false
  });

  const identity = (await http.request({method: "GET", path: "/api/cli/identity"})).data as CliIdentity;

  // Don't trust the user's env pick. The /identity response tells us which
  // env this token belongs to; mismatching it would store the token in the
  // wrong slot and silently make every subsequent command hit the wrong
  // environment.
  const serverEnv = identity?.key?.env?.toLowerCase();
  if (serverEnv && serverEnv !== env) {
    throw new AtoaError(
      `this token belongs to ${serverEnv} but you picked ${env}. ` +
        `Re-run login and pick ${serverEnv}, or paste a ${env} token instead.`,
      "validation"
    );
  }

  if (!identity?.merchantId) {
    throw new AtoaError(
      "Server did not return a merchantId for this token — cannot create profile. Contact support if this persists.",
      "auth"
    );
  }
  const businessId = identity.merchantId;
  const businessName = identity?.businessName;
  const profileName = await deriveProfileName({
    explicit: args.profile,
    businessName,
    businessId
  });

  const store = await createSecretsStore();
  await store.set(profileName, env, token);

  const pastedEnvState: EnvState = {
    ...(identity?.key?.sdkAccessId ? {sdkAccessId: identity.key.sdkAccessId} : {}),
    tokenFingerprint: fingerprintToken(token)
  };

  // Merge with any existing profile so we don't blow away the OTHER env's state.
  const existing = await readProfile(profileName);
  const profile = existing
    ? {
        ...existing,
        businessId: businessId || existing.businessId,
        displayName: businessName || existing.displayName,
        defaultEnv: env,
        envs: {...existing.envs, [env]: pastedEnvState}
      }
    : {
        ...newProfile({businessId, displayName: businessName || profileName, defaultEnv: env}),
        envs: {[env]: pastedEnvState}
      };
  await writeProfile(profileName, profile);

  // Always promote the just-logged-in profile to active. The user paired this
  // device now → that's the business they want to operate as. They can switch
  // back to a different default with `atoa profile use <name>`.
  const cfg = await readConfig();
  const wasAlreadyActive = cfg.activeProfile === profileName;
  if (!wasAlreadyActive) await writeConfig({...cfg, activeProfile: profileName});

  const parts = [
    `✓ stored ${env} token under profile "${profileName}" (${wasAlreadyActive ? "already active" : "now active"}) (${store.backend()})`,
    businessName ? `  business: ${businessName}` : null,
    `  key: …${token.slice(-4)}`
  ].filter(Boolean);
  process.stdout.write(parts.join("\n") + "\n");
}

async function resolveEnv(args: {env?: string; stdin?: boolean}): Promise<Env> {
  if (args.env) return parseEnvFlag(args.env);

  if (!process.stdin.isTTY) {
    throw new AtoaError(
      "--env=<sandbox|production> is required when stdin is not a TTY. " +
        "Re-run with --env=sandbox or --env=production.",
      "validation"
    );
  }

  return await select({
    message: "Select environment:",
    choices: [
      {value: "sandbox", name: "sandbox"},
      {value: "production", name: "production"}
    ],
    default: "sandbox"
  });
}
