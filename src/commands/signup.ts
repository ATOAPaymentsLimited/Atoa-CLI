/* eslint-disable complexity */
/* eslint-disable max-lines-per-function */
/* eslint-disable max-lines */
import {defineCommand} from "citty";
import {randomUUID} from "node:crypto";
import {input, confirm, select} from "@inquirer/prompts";
import {withCommonArgs, type CommonOptions} from "./_common";
import {V1_ROUTES} from "../lib/v1-routes";
import {AtoaError, printError, exitCodeFor} from "../lib/errors";
import {buildContext, type CommandContext} from "../lib/context";
import {buildHttpClient, assertTlsHardenedEnv} from "../lib/http";
import {createSecretsStore} from "../lib/secrets-store";
import {resolveBaseUrl, resolveDashboardUrl} from "../lib/env";
import {normalizeBusinesses} from "../lib/businesses";
import {onboardingResumeState, type BusinessRecord} from "../lib/onboarding-resume";
import {
  setActiveBusinessId,
  getActiveBusinessId,
  deriveProfileName,
  renameProfile,
  resolveActiveProfile,
  readProfile,
  writeProfile,
  newProfile,
  readConfig,
  writeConfig,
  getDeviceName
} from "../lib/config-store";
import {withOtp} from "../lib/otp";
import {isInteractive, renderKeyValues} from "../lib/output";
import {
  isValidEmail,
  validateName,
  validateBusinessName,
  validateAddress,
  validatePostcode,
  validateCountryCode,
  validatePhoneNumber
} from "../lib/validators";

type SignupArgs = CommonOptions & {
  email?: string;
  fromStep?: string;
  skipExtras?: boolean;
  deviceName?: string;
};

export default defineCommand({
  meta: {
    name: "signup",
    description: "Create a new Atoa account (email + OTP) and onboard a business — no prior login needed"
  },
  args: withCommonArgs({
    email: {type: "string", description: "email to sign up with (skips the prompt)"},
    fromStep: {type: "string", description: "resume from step N (2-4); requires businessId already set"},
    skipExtras: {type: "boolean", description: "skip step 4 extras and finalize immediately"},
    deviceName: {type: "string", description: "label for this device in your Atoa sessions"}
  }),
  async run({args: cittyArgs}) {
    const args = cittyArgs as unknown as SignupArgs;
    try {
      assertTlsHardenedEnv();

      // Step 0: ensure we have a session. A brand-new user has none → create the
      // account here (email + OTP). If a session already exists, this is a no-op.
      await ensureSignedUp(args);

      // allowIncomplete: a freshly-created account has no businessId until step-1 below.
      const ctx = await buildContext(args, {allowIncomplete: true});
      await runOnboarding(ctx, args);
    } catch (err) {
      printError(err);
      process.exitCode = exitCodeFor((err as AtoaError).kind);
    }
  }
});

/**
 * Ensures the resolved profile has a JWT session. When it doesn't (the common new-user case),
 * runs the in-CLI OTP signup to create the account and store a CLI-source session. The session
 * is env-independent (keyed by profile), so there's no env to thread here. No-op when a session
 * already exists.
 */
async function ensureSignedUp(args: SignupArgs): Promise<string | undefined> {
  const resolved = await resolveActiveProfile(args.profile);
  if (resolved.kind === "ok") {
    const store = await createSecretsStore();
    const tokens = await store.getJwtTokens(resolved.name);
    if (tokens) return undefined; // already signed in
  }
  return otpSignup(args);
}

/**
 * In-CLI account creation via the existing public auth endpoints:
 *   otp/send → otp/verify-otp (→ otpVerifiedToken) → user/auth/sign-up (Bearer that token,
 *   source=CLI + device → CLI-source JWT). Stores the session and activates the profile.
 */
async function otpSignup(args: SignupArgs): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new AtoaError("atoa signup needs an interactive terminal (email + OTP). Run it in a terminal.", "validation");
  }

  process.stderr.write("\nCreate your Atoa account\n─────────────────────────────────────────\n");
  const email = (args.email || (await input({message: "Email address:"}))).trim();
  if (!isValidEmail(email)) throw new AtoaError("Please enter a valid email address", "validation");

  // No credentials yet → a bare (auth: "none") client for the public auth endpoints.
  const http = buildHttpClient({baseUrl: resolveBaseUrl(), authHeader: "unused", verbose: !!args.verbose});

  await http.request({...V1_ROUTES.auth.otpSend, body: {email}});
  process.stderr.write(`An OTP has been sent to ${email}.\n`);

  // Verify the OTP → otpVerifiedToken (retry on wrong code).
  const MAX = 5;
  let otpVerifiedToken = "";
  for (let attempt = 1; attempt <= MAX; attempt++) {
    const otp = (await input({message: `OTP (attempt ${attempt}/${MAX}):`})).trim();
    try {
      const res = await http.request({...V1_ROUTES.auth.otpVerify, body: {email, otp}});
      const token = (res.data as {otpVerifiedToken?: string})?.otpVerifiedToken;
      if (!token) throw new AtoaError("OTP verification did not return a token.", "auth", {requestId: res.requestId});
      otpVerifiedToken = token;
      break;
    } catch (err) {
      const ae = err as AtoaError;
      if (ae.status === 429) {
        throw new AtoaError(
          `OTP rate limit reached${ae.message ? ": " + ae.message : ""}. Please wait and retry.`,
          "rate_limit",
          {
            status: ae.status,
            requestId: ae.requestId
          }
        );
      }
      // 400 wrong code / 403 invalid-token — retry while attempts remain, else give up cleanly.
      if (ae.status === 400 || ae.status === 403) {
        if (attempt < MAX) {
          // Backend supplies the precise reason + remaining count (wrong code / expired / N left).
          process.stderr.write(`${ae.message}\n`);
          continue;
        }

        throw new AtoaError(ae.message || "Too many incorrect OTP attempts. Please generate a new OTP.", "validation", {
          status: ae.status,
          requestId: ae.requestId
        });
      }
      throw err;
    }
  }

  // Sign up — source=CLI + device makes the backend mint a CLI-source, device-keyed token
  // that the onboarding API accepts.
  // Per-profile device id (not machine-level): reuse an explicit --profile's stored id, else a
  // fresh one, so each profile gets its own backend session slot (see login.ts for the why).
  const reuseDeviceId = args.profile ? (await readProfile(args.profile))?.clientDeviceId : undefined;
  const clientDeviceId = reuseDeviceId ?? randomUUID();
  const deviceName = args.deviceName || getDeviceName();
  const signRes = await http.request({
    ...V1_ROUTES.auth.signUp,
    headers: {Authorization: `Bearer ${otpVerifiedToken}`},
    body: {email, source: "CLI", device: {clientDeviceId, deviceName}}
  });
  const grant = (signRes.data ?? {}) as {accessToken?: string; refreshToken?: string};
  if (!grant.accessToken || !grant.refreshToken) {
    throw new AtoaError("Signup did not return tokens — contact support if this persists.", "auth", {
      requestId: signRes.requestId
    });
  }

  // Persist the session + activate a profile (named from the email; renamed to the
  // business slug after onboarding step-2 by the existing rename below).
  const profileName = await deriveProfileName({
    explicit: args.profile,
    businessName: email.split("@")[0],
    businessId: ""
  });
  const store = await createSecretsStore();
  await store.setJwtTokens(profileName, {accessToken: grant.accessToken, refreshToken: grant.refreshToken});

  // The profile is NOT env-scoped — the JWT session (just stored) is env-independent. Per-env
  // state (SDK keys) is created separately later. Merge to preserve any existing envs/defaultEnv.
  const existing = await readProfile(profileName);
  const profile = existing
    ? {...existing, clientDeviceId}
    : {...newProfile({businessId: "", displayName: email}), clientDeviceId};
  await writeProfile(profileName, profile);

  const cfg = await readConfig();
  if (cfg.activeProfile !== profileName) await writeConfig({...cfg, activeProfile: profileName});

  process.stderr.write(`✓ Account created. Signed in as "${profileName}".\n`);
  return email;
}

type StartDecision =
  | {kind: "start"; fromStep: number; seedInfo?: Record<string, unknown>; startingNew?: boolean}
  | {kind: "done"; message: string};

/** Fetch a business record (status + businessInfo) by id, for resume detection and seeding. */
async function fetchBusinessRecord(
  ctx: CommandContext,
  businessId: string
): Promise<BusinessRecord & {businessInfo?: Record<string, unknown>}> {
  const data = (await ctx.http.request({...V1_ROUTES.onboarding.getBusiness, pathParams: {businessId}})).data as {
    business?: {
      status?: string;
      businessInfo?: Record<string, unknown>;
      merchantBusinessInfo?: Record<string, unknown>;
    };
  };
  const biz = data.business ?? {};
  return {status: biz.status, businessInfo: biz.businessInfo ?? biz.merchantBusinessInfo};
}

/** The account's business id: the one bound to this profile, else the account's first business from the server. */
async function discoverBusinessId(ctx: CommandContext): Promise<string | undefined> {
  const local = await getActiveBusinessId(ctx.profileName);
  if (local) return local;
  try {
    const id = normalizeBusinesses((await ctx.http.request({...V1_ROUTES.businesses.list})).data)[0]?.id;
    if (id) await setActiveBusinessId(ctx.profileName, id); // cache so later step requests resolve :businessId
    return id;
  } catch {
    return undefined;
  }
}

/**
 * Decide which step to start at. Honors an explicit --from-step; otherwise auto-detects an
 * in-progress business and prompts the user to continue it (jumping to the first incomplete
 * step) or start a new one. Progress is inferred from populated fields — see onboarding-resume.ts.
 */
async function resolveOnboardingStart(ctx: CommandContext, args: SignupArgs): Promise<StartDecision> {
  // Explicit override — power-user path, no prompt.
  if (args.fromStep) {
    const n = parseInt(args.fromStep, 10);
    if (isNaN(n) || n < 1 || n > 4) throw new AtoaError("--from-step must be a number between 1 and 4", "validation");
    if (n === 1) return {kind: "start", fromStep: 1};
    const bizId = await getActiveBusinessId(ctx.profileName);
    if (!bizId) {
      throw new AtoaError(
        `--from-step ${n} requires an active business ID. Run from step 1, or set the business with \`atoa business use <id>\`.`,
        "validation"
      );
    }
    // Best-effort seed (as before: a fetch failure still lets the entered data through).
    try {
      return {kind: "start", fromStep: n, seedInfo: (await fetchBusinessRecord(ctx, bizId)).businessInfo};
    } catch {
      return {kind: "start", fromStep: n};
    }
  }

  // Auto-detect. No business yet → brand-new signup, straight to step 1 (no prompt).
  const bizId = await discoverBusinessId(ctx);
  if (!bizId) return {kind: "start", fromStep: 1};

  let record: BusinessRecord & {businessInfo?: Record<string, unknown>};
  try {
    record = await fetchBusinessRecord(ctx, bizId);
  } catch {
    throw new AtoaError("Couldn't load your in-progress signup. Check your connection and try again.", "network");
  }

  const state = onboardingResumeState(record);
  const name = (record.businessInfo?.legalBusinessName as string) || "your business";

  if (state.kind === "resume") {
    const choice = await select({
      message: `You have an in-progress signup for "${name}".`,
      choices: [
        {name: `Continue where you left off (step ${state.step} of 4)`, value: "continue"},
        {name: "Start a new business from scratch", value: "new"}
      ]
    });
    if (choice === "continue") return {kind: "start", fromStep: state.step, seedInfo: record.businessInfo};
    return {kind: "start", fromStep: 1, startingNew: true};
  }

  // Nothing to resume: fully onboarded, or KYB has locked the business past editing.
  process.stderr.write(
    (state.kind === "locked"
      ? `"${name}" is already ${state.status.replace(/_/g, " ").toLowerCase()} and can't be edited from the CLI.`
      : `"${name}" is already fully onboarded.`) + "\n"
  );
  if (!(await confirm({message: "Start a new business from scratch?", default: false}))) {
    return {kind: "done", message: "Nothing to do."};
  }
  return {kind: "start", fromStep: 1, startingNew: true};
}

/** The onboarding wizard (steps 1–4), run with an authed context. */
async function runOnboarding(ctx: CommandContext, args: SignupArgs): Promise<void> {
  // Wizard is interactive-only
  if (!process.stdin.isTTY) {
    throw new AtoaError("atoa signup is an interactive wizard and requires a TTY. Run it in a terminal.", "validation");
  }

  // Decide where to start: an explicit --from-step, or auto-detect an in-progress
  // business and let the user continue it (jump to the first incomplete step) or start over.
  const start = await resolveOnboardingStart(ctx, args);
  if (start.kind === "done") {
    process.stderr.write(start.message + "\n");
    return;
  }
  const fromStep = start.fromStep;
  const startingNewOverExisting = start.startingNew ?? false;

  process.stderr.write("Atoa onboarding wizard\n");
  process.stderr.write("─────────────────────────────────────────\n");

  // Captured in step 1 (business name) so we can rename the profile to the business slug at the end.
  let createdBusinessName: string | undefined;

  // Accumulated business details. The backend updateBusiness REPLACES businessInfo whenever
  // businessType is present, so every updateBusiness call must carry the FULL businessInfo
  // — we build it up across steps and resend it whole each time.
  const businessInfo: Record<string, unknown> = {};

  // On resume the business already exists; seed the accumulator from the server record fetched
  // during step resolution so the full-businessInfo resend doesn't wipe fields set in earlier steps.
  if (start.seedInfo) {
    for (const k of [
      "legalBusinessName",
      "tradingName",
      "businessType",
      "companyType",
      "addressLine1",
      "addressLine2",
      "addressPostalCode",
      "cityOrTown",
      "averageMonthlyTransaction"
    ]) {
      if (start.seedInfo[k] != null) businessInfo[k] = start.seedInfo[k];
    }
    createdBusinessName = (businessInfo.tradingName ?? businessInfo.legalBusinessName) as string | undefined;
  }

  // Prefill from the signed-in user's identity so we don't re-ask for data the
  // account already has (name/contact) — the prompts use these as defaults, so you
  // press Enter to accept or type to override. Best-effort: a brand-new user with no
  // business context yet (or any failure) just falls back to blank prompts.
  let prefill: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phoneCountryCode?: string;
    phoneNumber?: string;
  } = {};
  try {
    prefill = (await ctx.http.request({...V1_ROUTES.identity.get})).data as typeof prefill;
  } catch {
    prefill = {};
  }

  // ── Step 1: Business details (name, industry, consent) ───────────────────
  if (fromStep <= 1) {
    process.stderr.write("\nStep 1 of 4 — Business details\n");

    const legalBusinessName = await input({message: "Business name:", validate: validateBusinessName});

    // Industry / business type is a server-side lookup (env-specific ids); fetch and pick.
    const types = (await ctx.http.request({...V1_ROUTES.onboarding.businessTypes})).data as Array<{
      id: string;
      name: string;
    }>;
    let businessType: {id: string; name: string} | undefined;
    if (types.length) {
      const id = await select({message: "Industry:", choices: types.map((t) => ({value: t.id, name: t.name}))});
      businessType = types.find((t) => t.id === id);
    }

    // Consent. Privacy Policy + Terms of Service are required; marketing updates are an optional opt-in.
    const acceptPrivacy = await confirm({
      message: "I accept Atoa's Privacy Policy (https://paywithatoa.co.uk/atoa-business-privacy-policy/)"
    });
    if (!acceptPrivacy) {
      throw new AtoaError("You must accept the Privacy Policy to continue.", "validation");
    }
    const acceptTos = await confirm({message: "I accept Atoa's Terms of Service (https://paywithatoa.co.uk/terms/)"});
    if (!acceptTos) {
      throw new AtoaError("You must accept the Terms of Service to continue.", "validation");
    }
    const allowMarketingEmails = await confirm({
      message: "I would like to get marketing and product updates from Atoa.",
      default: false
    });

    businessInfo.legalBusinessName = legalBusinessName;
    businessInfo.tradingName = legalBusinessName;
    if (businessType) businessInfo.businessType = businessType;

    // Create the business (createBusiness takes the businessInfo FLAT as the whole body).
    // The backend refuses a second business while an existing one is still pending/in-review/etc.
    // When starting over an existing business, surface that error and point to the dashboard.
    const res = await ctx.http
      .request({...V1_ROUTES.onboarding.createBusiness, body: businessInfo})
      .catch((err: AtoaError) => {
        if (!startingNewOverExisting) throw err;
        throw new AtoaError(
          `${err.message}\nTo manage or finish your existing business, use the dashboard: ${resolveDashboardUrl()}`,
          err.kind ?? "generic",
          {status: err.status, requestId: err.requestId}
        );
      });
    const businessId = (res.data as {business?: {id?: string}})?.business?.id;
    if (!businessId) {
      throw new AtoaError("Create-business response did not include a business id.", "generic");
    }
    await setActiveBusinessId(ctx.profileName, businessId);
    createdBusinessName = legalBusinessName;

    // Record consent: accept-terms (privacy + ToS) and marketing preference (user + business level).
    await ctx.http.request({...V1_ROUTES.onboarding.acceptTerms});
    await ctx.http.request({...V1_ROUTES.onboarding.notificationOptions, body: {allowMarketingEmails}});
    await ctx.http.request({...V1_ROUTES.onboarding.marketingConsent, body: {enabled: allowMarketingEmails}});

    process.stderr.write(`✓ Business created: ${businessId}\n`);
  }

  // ── Step 2: Business structure ───────────────────────────────────────────
  if (fromStep <= 2) {
    process.stderr.write("\nStep 2 of 4 — Business structure\n");
    // Product restricts CLI signup to Limited Company + Charity (the backend enum also has
    // SOLE_TRADER — do not re-add without product sign-off).
    const companyType = await select({
      message: "Business structure:",
      choices: [
        {name: "Limited Company", value: "COMPANY_LTD"},
        {name: "Charity", value: "CHARITY"}
      ]
    });
    businessInfo.companyType = companyType;
    await ctx.http.request({...V1_ROUTES.onboarding.updateBusiness, body: {businessInfo}});
    process.stderr.write("✓ Business structure saved.\n");
  }

  // ── Step 3: Personal details ─────────────────────────────────────────────
  if (fromStep <= 3) {
    process.stderr.write("\nStep 3 of 4 — Personal details\n");
    const firstName = await input({
      message: "First name:",
      default: prefill.firstName,
      validate: validateName("First name")
    });
    const lastName = await input({
      message: "Last name:",
      default: prefill.lastName,
      validate: validateName("Last name")
    });
    await ctx.http.request({...V1_ROUTES.onboarding.updateProfile, body: {firstName, lastName}});

    // Phone is optional. When supplied, the contact update may require OTP — withOtp handles the
    // "send → prompt → verify" two-step (re-sends the same request with the code).
    const phoneCountryCode = await input({
      message: "Phone country code, e.g. 44 (optional):",
      default: prefill.phoneCountryCode || "44",
      validate: validateCountryCode
    });
    const phoneNumber = await input({
      message: "Phone number without country code (optional):",
      default: prefill.phoneNumber,
      validate: validatePhoneNumber
    });
    if (phoneNumber) {
      const contactBody: Record<string, unknown> = {phoneNumber};
      if (phoneCountryCode) contactBody["phoneCountryCode"] = phoneCountryCode;
      const {otpUsed} = await withOtp(ctx.http, {
        send: V1_ROUTES.onboarding.updateContact,
        verify: V1_ROUTES.onboarding.updateContact,
        body: contactBody,
        onOtpSent: () => process.stderr.write("An OTP has been sent to your phone. Enter it below.\n")
      });
      process.stderr.write(otpUsed ? "✓ Phone verified.\n" : "✓ Phone saved.\n");
    }

    // Business address (part of businessInfo — resend the full accumulator).
    const addressLine1 = await input({message: "Business address:", validate: validateAddress});
    const addressPostalCode = (
      await input({message: "Postal code:", transformer: (v) => v.toUpperCase(), validate: validatePostcode})
    ).toUpperCase();
    businessInfo.addressLine1 = addressLine1;
    businessInfo.addressPostalCode = addressPostalCode;
    await ctx.http.request({...V1_ROUTES.onboarding.updateBusiness, body: {businessInfo}});
    process.stderr.write("✓ Personal details saved.\n");
  }

  // ── Step 4: Monthly turnover + how did you hear about us ──────────────────
  if (fromStep <= 4 && !args.skipExtras) {
    process.stderr.write("\nStep 4 of 4 — A bit more about your business\n");

    // Average monthly transaction — selectable from the server-defined ranges.
    const ranges = (await ctx.http.request({...V1_ROUTES.onboarding.transactionRanges})).data as string[];
    let averageMonthlyTransaction: string | undefined;
    if (ranges.length) {
      averageMonthlyTransaction =
        (await select({
          message: "Monthly turnover:",
          choices: [{name: "(skip)", value: ""}, ...ranges.map((r) => ({value: r, name: r}))]
        })) || undefined;
    }

    // How did you hear about us — server-defined options (sent as the option's description).
    const sources = (await ctx.http.request({...V1_ROUTES.onboarding.signupSources})).data as Array<{
      id: string;
      description: string;
    }>;
    let sourceOfInstall: string | undefined;
    if (sources.length) {
      sourceOfInstall =
        (await select({
          message: "How did you hear about us?",
          choices: [{name: "(skip)", value: ""}, ...sources.map((s) => ({value: s.description, name: s.description}))]
        })) || undefined;
    }

    if (averageMonthlyTransaction) businessInfo.averageMonthlyTransaction = averageMonthlyTransaction;
    const extrasBody: Record<string, unknown> = {businessInfo};
    if (sourceOfInstall) extrasBody["sourceOfInstall"] = sourceOfInstall;
    await ctx.http.request({...V1_ROUTES.onboarding.updateBusiness, body: extrasBody});
    process.stderr.write("✓ Onboarding complete.\n");
  } else if (fromStep <= 4 && args.skipExtras) {
    process.stderr.write("\n✓ Onboarding complete (optional info skipped).\n");
  }

  const bizId = await getActiveBusinessId(ctx.profileName);

  // Rename the profile to the new business slug so it matches the business it now points at.
  let profileName = ctx.profileName;
  if (createdBusinessName && bizId) {
    const newName = await deriveProfileName({businessName: createdBusinessName, businessId: bizId});
    if (newName !== profileName) {
      await renameProfile(profileName, newName, {businessId: bizId, displayName: createdBusinessName});
      process.stderr.write(`✓ Profile renamed to "${newName}".\n`);
      profileName = newName;
    }
  }

  if (!isInteractive(ctx.formatExplicit)) {
    ctx.print({status: "complete", businessId: bizId ?? null, profile: profileName});
    return;
  }
  process.stdout.write(
    renderKeyValues("✓ Onboarding complete", [
      ["Business", createdBusinessName],
      ["Business ID", bizId ?? undefined],
      ["Profile", profileName]
    ]) + "\n"
  );
}
