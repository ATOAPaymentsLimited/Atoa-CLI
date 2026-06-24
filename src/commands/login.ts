import {defineCommand} from "citty";
import {randomUUID} from "node:crypto";
import {select, confirm} from "@inquirer/prompts";
import {parseEnvFlag, resolveBaseUrl, resolveDashboardUrl, type Env} from "../lib/env";
import {fingerprintToken} from "../lib/auth";
import {buildHttpClient, assertTlsHardenedEnv, type HttpClient, type JwtSession} from "../lib/http";
import {createSecretsStore, type JwtTokens, type SecretsStore} from "../lib/secrets-store";
import {
  readConfig,
  writeConfig,
  writeProfile,
  readProfile,
  deriveProfileName,
  newProfile,
  getDeviceName,
  setActiveBusinessId,
  type EnvState
} from "../lib/config-store";
import {AtoaError, printError, exitCodeFor} from "../lib/errors";
import {generatePkcePair, generateState} from "../lib/pkce";
import {startLoopbackServer} from "../lib/loopback-server";
import {openBrowser} from "../lib/browser";
import {V1_ROUTES} from "../lib/v1-routes";
import {normalizeBusinesses, type BusinessSummary} from "../lib/businesses";

interface LoginArgs {
  env?: string;
  profile?: string;
}

export default defineCommand({
  meta: {
    name: "login",
    description: "Log in to an Atoa merchant account via your browser."
  },
  args: {
    env: {type: "string", description: "sandbox|production (skips the interactive prompt when supplied)"},
    profile: {
      type: "string",
      description: "profile name to store credentials under (defaults to slugified business name)"
    }
  },
  async run({args}) {
    try {
      assertTlsHardenedEnv();
      await browserFlow(args);
    } catch (err) {
      printError(err);
      process.exitCode = exitCodeFor((err as AtoaError).kind);
    }
  }
});

// ---- Browser (PKCE) flow ------------------------------------------------------

async function browserFlow(args: LoginArgs): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new AtoaError(
      "Browser login needs an interactive terminal and a desktop browser. Run `atoa login` in a terminal.",
      "validation"
    );
  }

  // Browser (JWT) login authenticates against a single control-plane backend
  // (resolveBaseUrl is env-independent), so there's no sandbox-vs-production auth
  // choice to make here. Skip the prompt and default to production; `env` only
  // namespaces the stored session and picks which env --provision-key mints for,
  // both overridable with an explicit --env.
  const env: Env = args.env ? parseEnvFlag(args.env) : "production";

  // The JWT pair lives in memory until the profile name is known — it is
  // derived from the business we only discover via authenticated calls below.
  const session = createInMemorySession();
  const http = buildHttpClient({
    baseUrl: resolveBaseUrl(),
    // Browser flow never issues `auth: "sdk"` requests, so no SDK header exists.
    authHeader: "unused",
    verbose: false,
    jwt: session.seam
  });

  // Per-profile device identity (NOT machine-level): the backend keys CLI JWTs by
  // userId+source+deviceId and evicts the prior token on each login. A shared machine id made
  // every business-profile collide on one slot, expiring the others. On an explicit --profile
  // re-login we reuse that profile's stored id (clean replace); a bare login mints a fresh id so
  // it can never evict another profile (the resolved business isn't known until after the grant).
  const reuseDeviceId = args.profile ? (await readProfile(args.profile))?.clientDeviceId : undefined;
  const clientDeviceId = reuseDeviceId ?? randomUUID();

  const {code, verifier, state} = await authoriseInBrowser(clientDeviceId);
  const grant = await exchangeForTokens(http, {code, verifier, state});
  session.setTokens(grant.tokens);

  const business = await resolveBusiness(http, session, grant.businessId);
  const profileName = await deriveProfileName({
    explicit: args.profile,
    businessName: business.businessName,
    businessId: business.businessId
  });

  // Which business this login binds to is decided by the DASHBOARD (the grant authorises
  // whichever business your browser session is on), NOT the CLI's active profile. Guard the
  // two ways that surprises the user.
  const cfgBefore = await readConfig();
  const previousActive = cfgBefore.activeProfile;
  const existingForName = await readProfile(profileName);

  // (a) Re-bind: the target profile already exists but points at a DIFFERENT business.
  if (existingForName?.businessId && existingForName.businessId !== business.businessId) {
    const proceed = await confirm({
      message:
        `Profile "${profileName}" is bound to business ${existingForName.businessId}` +
        `${existingForName.displayName ? ` (${existingForName.displayName})` : ""}, but you just ` +
        `authorised "${business.businessName ?? business.businessId}". Re-bind it to the new business?`,
      default: false
    }).catch(() => false);
    if (!proceed) {
      throw new AtoaError("Login cancelled — profile left unchanged.", "validation");
    }
  }

  // (b) Heads-up: bare `login` followed the dashboard's business, not your active CLI profile.
  if (!args.profile && previousActive && previousActive !== profileName) {
    process.stderr.write(
      `Note: active profile was "${previousActive}", but this login authorised business ` +
        `"${business.businessName ?? business.businessId}" → profile "${profileName}" (now active).\n` +
        "  Browser login uses whichever business your dashboard is currently on. To target a " +
        "different business, switch it in the dashboard first, then re-run `atoa login`.\n"
    );
  }

  const store = await createSecretsStore();
  const wasAlreadyActive = await persistBrowserLogin({
    store,
    env,
    profileName,
    tokens: session.getTokens(),
    business,
    clientDeviceId
  });

  const parts = [
    `✓ logged in to ${env} as profile "${profileName}" (${wasAlreadyActive ? "already active" : "now active"}) (${store.backend()})`,
    business.businessName ? `  business: ${business.businessName}` : null,
    "  auth: browser session (JWT)"
  ].filter(Boolean);
  process.stdout.write(parts.join("\n") + "\n");
}

interface LoginSession {
  /** Seam handed to buildHttpClient for `auth: "jwt"` requests. */
  seam: JwtSession;
  getTokens(): JwtTokens;
  setTokens(tokens: JwtTokens): void;
  setBusinessId(id: string): void;
}

/**
 * In-memory JwtSession: the freshly-exchanged pair must back `auth: "jwt"`
 * requests (identity/businesses) before any profile-keyed secret slot exists.
 */
function createInMemorySession(): LoginSession {
  let tokens: JwtTokens | null = null;
  let businessId: string | undefined;
  return {
    seam: {
      getTokens: async () => tokens,
      setTokens: async (next) => {
        tokens = next;
      },
      clearTokens: async () => {
        tokens = null;
      },
      getActiveBusinessId: async () => businessId
    },
    getTokens: () => {
      if (!tokens) throw new AtoaError("Session lost its tokens mid-login — re-run `atoa login`.", "auth");
      return tokens;
    },
    setTokens: (next) => {
      tokens = next;
    },
    setBusinessId: (id) => {
      businessId = id;
    }
  };
}

/**
 * Generates PKCE material, opens the grant page, and waits for the loopback
 * callback. Resolves with the one-time code plus the verifier/state needed
 * for the exchange. The loopback server validates the callback's state.
 */
async function authoriseInBrowser(clientDeviceId: string): Promise<{code: string; verifier: string; state: string}> {
  const {verifier, challenge} = generatePkcePair();
  const state = generateState();
  const deviceName = getDeviceName();

  // The loopback server must be listening BEFORE the browser opens — the grant
  // page redirects to its OS-assigned port.
  const server = await startLoopbackServer({expectedState: state});
  try {
    const grantUrl = buildGrantUrl({challenge, state, port: server.port, clientDeviceId, deviceName});
    process.stderr.write(
      `Opening your browser to authorise the Atoa CLI… if it doesn't open, visit:\n\n  ${grantUrl}\n\n`
    );
    const opened = await openBrowser(grantUrl);
    if (!opened) {
      process.stderr.write("Could not open a browser automatically — open the URL above manually.\n");
    }
    const {code} = await server.result;
    return {code, verifier, state};
  } catch (err) {
    throw mapCallbackError(err);
  } finally {
    // No-op when the result already settled (the server closes itself before
    // settling); only tears down a still-listening server on early exits.
    server.close();
  }
}

function buildGrantUrl(opts: {
  challenge: string;
  state: string;
  port: number;
  clientDeviceId: string;
  deviceName: string;
}): string {
  const url = new URL("/auth/extension-callback", resolveDashboardUrl());
  url.searchParams.set("source", "CLI");
  url.searchParams.set("code_challenge", opts.challenge);
  url.searchParams.set("state", opts.state);
  url.searchParams.set("redirect_uri", `http://127.0.0.1:${opts.port}/callback`);
  url.searchParams.set("client_device_id", opts.clientDeviceId);
  url.searchParams.set("device_name", opts.deviceName);
  return url.toString();
}

/**
 * Maps the loopback server's rejection reasons (plain Errors) to user-facing
 * auth failures. The CLI made no changes in any of these cases.
 */
function mapCallbackError(err: unknown): AtoaError {
  if (err instanceof AtoaError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("access_denied")) {
    return new AtoaError("Authorisation declined in the browser — no credentials were stored.", "auth");
  }
  if (msg.includes("timeout")) {
    return new AtoaError(
      "Timed out waiting for the browser authorisation. Re-run `atoa login` and approve the request within 3 minutes.",
      "auth"
    );
  }
  return new AtoaError(msg, "auth");
}

/**
 * POST /auth/extension-token/exchange (no Authorization header). Verifies the echoed state
 * before returning the pair — a mismatch means the code we redeemed wasn't
 * minted for THIS login attempt, so nothing may be stored.
 */
async function exchangeForTokens(
  http: HttpClient,
  opts: {code: string; verifier: string; state: string}
): Promise<{tokens: JwtTokens; businessId?: string}> {
  const exchange = await http.request({
    ...V1_ROUTES.auth.exchange,
    body: {code: opts.code, codeVerifier: opts.verifier}
  });
  const grant = exchange.data as {
    accessToken?: string;
    refreshToken?: string;
    userId?: string;
    businessId?: string;
    state?: string;
  };

  if (grant?.state !== opts.state) {
    throw new AtoaError(
      "Token exchange returned a mismatched state (possible tampering) — no credentials were stored. Re-run `atoa login`.",
      "auth",
      {requestId: exchange.requestId}
    );
  }
  if (!grant.accessToken || !grant.refreshToken) {
    throw new AtoaError("Token exchange response is missing tokens — contact support if this persists.", "auth", {
      requestId: exchange.requestId
    });
  }
  return {tokens: {accessToken: grant.accessToken, refreshToken: grant.refreshToken}, businessId: grant.businessId};
}

interface ResolvedBusiness {
  businessId: string;
  businessName?: string;
  /** The business this login binds to, persisted as the profile's active business. */
  selectedBusinessId?: string;
}

/**
 * Resolves which business this login binds to. The merchant-app endpoints take the
 * business in the URL (no X-Atoa-Business header), so the id comes from the businesses
 * list, not from identity: the grant's businessId wins if present; a single-business
 * account auto-selects; a multi-business account prompts (interactive) or defaults to
 * the first with a switch hint (non-interactive).
 */
async function resolveBusiness(
  http: HttpClient,
  session: LoginSession,
  grantBusinessId: string | undefined
): Promise<ResolvedBusiness> {
  const businesses = await fetchBusinesses(http);
  let selectedBusinessId = grantBusinessId;

  if (!selectedBusinessId) {
    if (businesses.length === 1) {
      selectedBusinessId = businesses[0].id;
    } else if (process.stdout.isTTY) {
      selectedBusinessId = await select({
        message: "This account belongs to multiple businesses — select one to work with:",
        choices: businesses.map((b) => ({name: `${b.legalBusinessName || "(unnamed)"} (${b.id})`, value: b.id}))
      });
    } else {
      // Can't prompt — finish the login with the first business and tell the user how to switch.
      process.stderr.write(
        "This account belongs to multiple businesses:\n" +
          businesses.map((b) => `  ${b.id}  ${b.legalBusinessName}`).join("\n") +
          "\nDefaulting to the first; switch with `atoa business use <id>`.\n"
      );
      selectedBusinessId = businesses[0].id;
    }
  }

  const businessId = selectedBusinessId ?? businesses[0]?.id;
  if (!businessId) {
    throw new AtoaError("Server did not return a businessId for this login — cannot create a profile.", "auth");
  }
  session.setBusinessId(businessId);

  const businessName = businesses.find((b) => b.id === businessId)?.legalBusinessName;
  return {businessId, businessName, selectedBusinessId: businessId};
}

async function fetchBusinesses(http: HttpClient): Promise<BusinessSummary[]> {
  const {data, requestId} = await http.request({...V1_ROUTES.businesses.list});
  const businesses = normalizeBusinesses(data);
  if (businesses.length === 0) {
    throw new AtoaError("Server returned no businesses for this account — contact support.", "auth", {requestId});
  }
  return businesses;
}

/**
 * Stores the JWT pair under the now-known profile, writes/merges the profile
 * entry (authMode "jwt"), records the selected business, and promotes the
 * profile to active. Returns whether it was already active.
 */
async function persistBrowserLogin(opts: {
  store: SecretsStore;
  env: Env;
  profileName: string;
  tokens: JwtTokens;
  business: ResolvedBusiness;
  clientDeviceId: string;
}): Promise<boolean> {
  const {store, env, profileName, tokens, business, clientDeviceId} = opts;

  await store.setJwtTokens(profileName, tokens);

  const jwtEnvState: EnvState = {
    tokenFingerprint: fingerprintToken(tokens.accessToken),
    authMode: "jwt"
  };

  // Merge with any existing profile so we don't blow away the OTHER env's
  // state, and keep this env's sdkAccessId (the SDK key is still valid).
  const existing = await readProfile(profileName);
  const profile = existing
    ? {
        ...existing,
        businessId: business.businessId,
        displayName: business.businessName || existing.displayName,
        defaultEnv: env,
        envs: {...existing.envs, [env]: {...existing.envs[env], ...jwtEnvState}},
        clientDeviceId
      }
    : {
        ...newProfile({
          businessId: business.businessId,
          displayName: business.businessName || profileName,
          defaultEnv: env
        }),
        envs: {[env]: jwtEnvState},
        clientDeviceId
      };
  await writeProfile(profileName, profile);

  // Only set after writeProfile — setActiveBusinessId requires the profile to exist.
  if (business.selectedBusinessId) await setActiveBusinessId(profileName, business.selectedBusinessId);

  // Always promote the just-logged-in profile to active (same rule as paste flow).
  const cfg = await readConfig();
  const wasAlreadyActive = cfg.activeProfile === profileName;
  if (!wasAlreadyActive) await writeConfig({...cfg, activeProfile: profileName});
  return wasAlreadyActive;
}
