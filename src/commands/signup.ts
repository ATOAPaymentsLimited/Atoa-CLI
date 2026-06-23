import {defineCommand} from "citty";
import {input, confirm, select} from "@inquirer/prompts";
import {withCommonArgs, type CommonOptions} from "./_common";
import {V1_ROUTES} from "../lib/v1-routes";
import {AtoaError, printError, exitCodeFor} from "../lib/errors";
import {buildContext, type CommandContext} from "../lib/context";
import {buildHttpClient, assertTlsHardenedEnv} from "../lib/http";
import {createSecretsStore} from "../lib/secrets-store";
import {fingerprintToken} from "../lib/auth";
import {parseEnvFlag, resolveBaseUrl, type Env} from "../lib/env";
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
  getOrCreateClientDeviceId,
  getDeviceName,
  type EnvState
} from "../lib/config-store";
import {withOtp} from "../lib/otp";
import {isInteractive, renderKeyValues} from "../lib/output";

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
      const env: Env = args.env ? parseEnvFlag(args.env) : "production";

      // Step 0: ensure we have a session. A brand-new user has none → create the
      // account here (email + OTP). If a session already exists, this is a no-op.
      const signupEmail = await ensureSignedUp(args, env);

      // allowIncomplete: a freshly-created account has no businessId until step-1 below.
      const ctx = await buildContext(args, {allowIncomplete: true});
      await runOnboarding(ctx, args, signupEmail);
    } catch (err) {
      printError(err);
      process.exitCode = exitCodeFor((err as AtoaError).kind);
    }
  }
});

/**
 * Ensures the resolved profile has a JWT session for `env`. When it doesn't (the
 * common new-user case), runs the in-CLI OTP signup to create the account and store
 * a CLI-source session. No-op when a session already exists.
 */
async function ensureSignedUp(args: SignupArgs, env: Env): Promise<string | undefined> {
  const resolved = await resolveActiveProfile(args.profile);
  if (resolved.kind === "ok") {
    const store = await createSecretsStore();
    const tokens = await store.getJwtTokens(resolved.name);
    if (tokens) return undefined; // already signed in for this env
  }
  return otpSignup(args, env);
}

/**
 * In-CLI account creation via the existing public auth endpoints:
 *   otp/send → otp/verify-otp (→ otpVerifiedToken) → user/auth/sign-up (Bearer that token,
 *   source=CLI + device → CLI-source JWT). Stores the session and activates the profile.
 */
async function otpSignup(args: SignupArgs, env: Env): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new AtoaError("atoa signup needs an interactive terminal (email + OTP). Run it in a terminal.", "validation");
  }

  process.stderr.write("\nCreate your Atoa account\n─────────────────────────────────────────\n");
  const email = (args.email || (await input({message: "Email address:"}))).trim();
  if (!email.includes("@")) throw new AtoaError("A valid email address is required.", "validation");

  // No credentials yet → a bare (auth: "none") client for the public auth endpoints.
  const http = buildHttpClient({baseUrl: resolveBaseUrl(), authHeader: "unused", verbose: !!args.verbose});

  await http.request({...V1_ROUTES.auth.otpSend, body: {email}});
  process.stderr.write(`An OTP has been sent to ${email}.\n`);

  // Verify the OTP → otpVerifiedToken (retry on wrong code).
  const MAX = 3;
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
      // 400 wrong code / 403 invalid-token — retry while attempts remain.
      if ((ae.status === 400 || ae.status === 403) && attempt < MAX) {
        process.stderr.write(`Invalid OTP. ${MAX - attempt} attempt(s) remaining.\n`);
        continue;
      }
      throw err;
    }
  }

  // Sign up — source=CLI + device makes the backend mint a CLI-source, device-keyed token
  // (UserAuthController.signUp extension) that the /v1 onboarding facade accepts.
  const clientDeviceId = await getOrCreateClientDeviceId();
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

  const envState: EnvState = {tokenFingerprint: fingerprintToken(grant.accessToken), authMode: "jwt"};
  const existing = await readProfile(profileName);
  const profile = existing
    ? {...existing, defaultEnv: env, envs: {...existing.envs, [env]: {...existing.envs[env], ...envState}}}
    : {...newProfile({businessId: "", displayName: email, defaultEnv: env}), envs: {[env]: envState}};
  await writeProfile(profileName, profile);

  const cfg = await readConfig();
  if (cfg.activeProfile !== profileName) await writeConfig({...cfg, activeProfile: profileName});

  process.stderr.write(`✓ Account created. Signed in as "${profileName}".\n`);
  return email;
}

/** The onboarding wizard (steps 1–4), run with an authed context. */
async function runOnboarding(ctx: CommandContext, args: SignupArgs, signupEmail?: string): Promise<void> {
  // Wizard is interactive-only
  if (!process.stdin.isTTY) {
    throw new AtoaError("atoa signup is an interactive wizard and requires a TTY. Run it in a terminal.", "validation");
  }

  const fromStep = args.fromStep ? parseInt(args.fromStep, 10) : 1;
  if (isNaN(fromStep) || fromStep < 1 || fromStep > 4) {
    throw new AtoaError("--from-step must be a number between 1 and 4", "validation");
  }

  // Steps >= 2 require an activeBusinessId
  if (fromStep >= 2) {
    const existingBizId = await getActiveBusinessId(ctx.profileName);
    if (!existingBizId) {
      throw new AtoaError(
        `--from-step ${fromStep} requires an active business ID. Run from step 1, or set the business with \`atoa business use <id>\`.`,
        "validation"
      );
    }
  }

  process.stderr.write("Atoa onboarding wizard\n");
  process.stderr.write("─────────────────────────────────────────\n");

  // Captured in step 2 so we can rename the profile to the business slug at the end.
  let createdBusinessName: string | undefined;

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

  // ── Step 1: account profile ─────────────────────────────────────────────
  if (fromStep <= 1) {
    process.stderr.write("\nStep 1 of 4 — Account profile\n");
    const firstName = await input({message: "First name:", default: prefill.firstName});
    const lastName = await input({message: "Last name:", default: prefill.lastName});

    const step1Body = {firstName, lastName};
    const step1Res = await ctx.http.request({...V1_ROUTES.onboarding.step1, body: step1Body});
    const step1Data = (step1Res.data ?? {}) as {businessId?: string; nextStep?: number};

    const businessId = step1Data.businessId;
    if (!businessId) {
      throw new AtoaError("Step 1 response did not include a businessId.", "generic");
    }

    // Persist immediately so subsequent requests send X-Atoa-Business
    await setActiveBusinessId(ctx.profileName, businessId);
    process.stderr.write(`✓ Account profile saved. Business shell created: ${businessId}\n`);
  }

  // ── Step 2: business details ────────────────────────────────────────────
  if (fromStep <= 2) {
    process.stderr.write("\nStep 2 of 4 — Business details\n");

    // Business type is a server-side lookup (env-specific ids), so fetch the list and let
    // the user pick — step-2 requires a valid businessType.id for a newly-created business.
    const types = (await ctx.http.request({...V1_ROUTES.businessTypes.list})).data as Array<{id: string; name: string}>;
    let businessType: {id: string; name: string} | undefined;
    if (types.length) {
      const id = await select({message: "Business type:", choices: types.map((t) => ({value: t.id, name: t.name}))});
      businessType = types.find((t) => t.id === id);
    }

    const legalBusinessName = await input({message: "Legal business name:"});

    // Legal structure drives which registration number we collect; both map to `crn`
    // (the backend compares companyType against MerchantBusinessTypeEnum).
    const companyType = await select({
      message: "Business structure:",
      choices: [
        {name: "Limited Company", value: "COMPANY_LTD"},
        {name: "Charity", value: "CHARITY"}
      ]
    });
    // CRNs (e.g. SC123123) and charity numbers are conventionally uppercase; transformer
    // capitalises the live echo, toUpperCase guarantees the stored value (transformer is display-only).
    const crn = (
      await input({
        message: companyType === "CHARITY" ? "Charity number:" : "Company registration number (CRN):",
        transformer: (v) => v.toUpperCase()
      })
    )
      .trim()
      .toUpperCase();

    const tradingName = await input({message: "Trading name (press Enter to use legal name):"});
    const addressLine1 = await input({message: "Address line 1:"});
    const addressLine2 = await input({message: "Address line 2 (optional):"});
    const cityOrTown = await input({message: "City / town:"});
    // Postcodes are conventionally uppercase; transformer capitalises the live echo,
    // toUpperCase guarantees the stored value (transformer is display-only).
    const addressPostalCode = (
      await input({message: "Postal code:", transformer: (v) => v.toUpperCase()})
    ).toUpperCase();

    const step2Body: Record<string, unknown> = {
      legalBusinessName,
      tradingName: tradingName || legalBusinessName,
      addressLine1,
      cityOrTown,
      addressPostalCode,
      companyType
    };
    if (addressLine2) step2Body["addressLine2"] = addressLine2;
    if (businessType) step2Body["businessType"] = businessType;
    if (crn) step2Body["crn"] = crn;

    await ctx.http.request({...V1_ROUTES.onboarding.step2, body: step2Body});
    createdBusinessName = step2Body["tradingName"] as string;
    process.stderr.write("✓ Business details saved.\n");
  }

  // ── Step 3: contact details + OTP ───────────────────────────────────────
  if (fromStep <= 3) {
    process.stderr.write("\nStep 3 of 4 — Contact details\n");
    // Default to the email you signed up with (already verified) so Enter keeps it unchanged → no re-OTP.
    const email = await input({message: "Email address (optional):", default: prefill.email || signupEmail});
    const phoneCountryCode = await input({
      message: "Phone country code, e.g. 44 (optional):",
      default: prefill.phoneCountryCode
    });
    const phoneNumber = await input({
      message: "Phone number without country code (optional):",
      default: prefill.phoneNumber
    });

    const step3Body: Record<string, unknown> = {};
    if (email) step3Body["email"] = email;
    if (phoneCountryCode) step3Body["phoneCountryCode"] = phoneCountryCode;
    if (phoneNumber) step3Body["phoneNumber"] = phoneNumber;

    // step-3 sends the OTP and reports OTP_VERIFICATION_IS_REQUIRED whenever the contact
    // changed; withOtp handles the "send → prompt → verify-otp" two-step. An unchanged
    // contact returns 2xx and no verification is needed.
    const {otpUsed} = await withOtp(ctx.http, {
      send: V1_ROUTES.onboarding.step3,
      verify: V1_ROUTES.onboarding.verifyOtp,
      body: step3Body,
      onOtpSent: () => process.stderr.write("An OTP has been sent to your contact. Enter it below.\n")
    });
    process.stderr.write(otpUsed ? "✓ OTP verified.\n" : "✓ Contact details saved (no verification needed).\n");
  }

  // ── Step 4: optional extras ─────────────────────────────────────────────
  if (fromStep <= 4) {
    process.stderr.write("\nStep 4 of 4 — Optional info\n");

    if (args.skipExtras) {
      await ctx.http.request({...V1_ROUTES.onboarding.skipStep4});
      process.stderr.write("✓ Onboarding complete (optional info skipped).\n");
    } else {
      // Average monthly transaction — selectable from the server-defined ranges.
      const ranges = (await ctx.http.request({...V1_ROUTES.onboarding.transactionRanges})).data as string[];
      let averageMonthlyTransaction: string | undefined;
      if (ranges.length) {
        averageMonthlyTransaction =
          (await select({
            message: "Average monthly transaction:",
            choices: [{name: "(skip)", value: ""}, ...ranges.map((r) => ({value: r, name: r}))]
          })) || undefined;
      }

      const sourceOfInstall = (await input({message: "How did you hear about us? (optional):"})) || undefined;

      // Consent. Privacy Policy + Terms of Service are required to complete
      // onboarding; marketing updates are an optional opt-in (default off).
      const acceptPrivacy = await confirm({
        message: "I accept Atoa's Privacy Policy (https://paywithatoa.co.uk/atoa-business-privacy-policy/)"
      });
      if (!acceptPrivacy) {
        throw new AtoaError("You must accept the Privacy Policy to complete onboarding.", "validation");
      }
      const acceptTos = await confirm({
        message: "I accept Atoa's Terms of Service (https://paywithatoa.co.uk/terms/)"
      });
      if (!acceptTos) {
        throw new AtoaError("You must accept the Terms of Service to complete onboarding.", "validation");
      }
      const allowMarketingEmails = await confirm({
        message: "I would like to get marketing and product updates from Atoa.",
        default: false
      });

      const step4Body: Record<string, unknown> = {acceptTerms: true, allowMarketingEmails};
      if (averageMonthlyTransaction) step4Body["averageMonthlyTransaction"] = averageMonthlyTransaction;
      if (sourceOfInstall) step4Body["sourceOfInstall"] = sourceOfInstall;

      await ctx.http.request({...V1_ROUTES.onboarding.step4, body: step4Body});
      process.stderr.write("✓ Onboarding complete.\n");
    }
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
