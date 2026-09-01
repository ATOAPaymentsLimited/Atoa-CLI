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
import {resolveField, resolveChoice} from "../lib/prompt-field";
import {t} from "../lib/i18n";
import {
  isValidEmail,
  validateName,
  validateBusinessName,
  validateAddress,
  validateAddressLine2,
  validatePostcode,
  validateCountryCode,
  validatePhoneNumber,
  validateVatNumber,
  normaliseVatNumber,
  validateWebsiteUrl
} from "../lib/validators";
import {DEFAULT_PHONE_COUNTRY_CODE} from "../lib/constants";

/** Sentinel: a code was sent and there was no terminal to enter it in. Surfaced as exit 9. */
const OTP_SENT = "__otp_sent__";

type SignupArgs = CommonOptions & {
  email?: string;
  otp?: string;
  fromStep?: string;
  deviceName?: string;
  acceptTerms?: boolean;
  marketing?: boolean;
  startNew?: boolean;
  businessName?: string;
  industry?: string;
  monthlyTurnover?: string;
  vatNumber?: string;
  websiteUrl?: string;
  businessStructure?: string;
  firstName?: string;
  lastName?: string;
  phoneCountryCode?: string;
  phoneNumber?: string;
  postalCode?: string;
  addressLine1?: string;
  addressLine2?: string;
};

export default defineCommand({
  meta: {
    name: "signup",
    description: t("cmdSignup")
  },
  args: withCommonArgs({
    email: {type: "string", description: t("argSignupEmail")},
    otp: {type: "string", description: t("argSignupOtp")},
    fromStep: {type: "string", description: t("argSignupFromStep")},
    deviceName: {type: "string", description: t("argSignupDeviceName")},
    acceptTerms: {type: "boolean", description: t("argSignupAcceptTerms")},
    marketing: {type: "boolean", description: t("argSignupMarketing")},
    startNew: {type: "boolean", description: t("argSignupStartNew")},
    businessName: {type: "string", description: t("argSignupBusinessName")},
    industry: {type: "string", description: t("argSignupIndustry")},
    monthlyTurnover: {type: "string", description: t("argSignupTurnover")},
    vatNumber: {type: "string", description: t("argSignupVat")},
    websiteUrl: {type: "string", description: t("argSignupWebsite")},
    businessStructure: {type: "string", description: t("argSignupStructure")},
    firstName: {type: "string", description: t("argSignupFirstName")},
    lastName: {type: "string", description: t("argSignupLastName")},
    phoneCountryCode: {type: "string", description: t("argSignupPhoneCc")},
    phoneNumber: {type: "string", description: t("argSignupPhone")},
    postalCode: {type: "string", description: t("argSignupPostalCode")},
    addressLine1: {type: "string", description: t("argSignupAddress1")},
    addressLine2: {type: "string", description: t("argSignupAddress2")}
  }),
  async run({args: cittyArgs}) {
    const args = cittyArgs as unknown as SignupArgs;
    try {
      assertTlsHardenedEnv();

      // Step 0: ensure we have a session. A brand-new user has none → create the
      // account here (email + OTP). If a session already exists, this is a no-op.
      // The code arrives out of band, so without a terminal to ask for it the run stops here
      // having sent one. Not a failure, but nothing was created either — its own exit code says
      // "re-run with --otp", which `bank add` also uses for the same state.
      if ((await ensureSignedUp(args)) === OTP_SENT) {
        process.exitCode = exitCodeFor("otp_required");
        return;
      }

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
  // `--profile <new-name>` names the profile this signup will CREATE (otpSignup passes it
  // to deriveProfileName). resolveActiveProfile throws on a name it doesn't know, which is
  // right for every other command but would reject exactly that case here — so look the
  // name up directly first and go straight to account creation when it's new.
  const explicitProfile = args.profile?.trim();
  if (explicitProfile && !(await readProfile(explicitProfile))) {
    return otpSignup(args);
  }

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
  const interactive = isInteractive(args.output !== undefined);

  process.stderr.write(t("signupHeading"));
  const email = await resolveField({
    value: args.email,
    flag: "email",
    message: t("labelEmailAddressPrompt"),
    rule: (v) => (isValidEmail(v.trim()) ? true : t("emailError")),
    interactive
  });

  // No credentials yet → a bare (auth: "none") client for the public auth endpoints.
  const http = buildHttpClient({baseUrl: resolveBaseUrl(), authHeader: "unused", verbose: !!args.verbose});

  // Only send when we don't already hold a code: a second send would invalidate the one the
  // caller is about to submit, and counts against the per-hour allowance.
  if (!args.otp?.trim()) {
    await http.request({...V1_ROUTES.auth.otpSend, body: {email}});
    process.stderr.write(t("otpSentTo", {email}));
    if (!interactive) {
      process.stderr.write(t("otpResumeWithFlag", {email}));
      return OTP_SENT;
    }
  }

  // Verify the OTP → otpVerifiedToken (retry on wrong code). A supplied --otp gets one attempt:
  // there is nobody to retype it, and re-running is the caller's retry.
  const MAX = args.otp?.trim() ? 1 : 5;
  let otpVerifiedToken = "";
  for (let attempt = 1; attempt <= MAX; attempt++) {
    const otp = args.otp?.trim() || (await input({message: t("labelOtpAttempt", {attempt, max: MAX})})).trim();
    try {
      const res = await http.request({...V1_ROUTES.auth.otpVerify, body: {email, otp}});
      const token = (res.data as {otpVerifiedToken?: string})?.otpVerifiedToken;
      if (!token) throw new AtoaError(t("otpNoTokenReturned"), "auth", {requestId: res.requestId});
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
    throw new AtoaError(t("signupNoTokens"), "auth", {
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
    if (isNaN(n) || n < 1 || n > 3) throw new AtoaError(t("fromStepRange"), "validation");
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
    throw new AtoaError(t("resumeLoadFailed"), "network");
  }

  const state = onboardingResumeState(record);
  const name = (record.businessInfo?.legalBusinessName as string) || "your business";

  // With nobody to ask, both branches below take the safe default — resume rather than start over,
  // and don't start a second business. --start-new is how a caller asks for the other branch
  // explicitly, so creating one is never something an unattended re-run does by itself.
  const interactive = isInteractive(ctx.formatExplicit);
  const wantsNew = Boolean(args.startNew);

  if (state.kind === "resume") {
    const choice =
      interactive && !wantsNew
        ? await select({
            message: t("resumePrompt", {name}),
            choices: [
              {name: t("resumeContinue", {step: state.step}), value: "continue"},
              {name: t("resumeStartNew"), value: "new"}
            ]
          })
        : wantsNew
          ? "new"
          : "continue";
    if (choice === "continue") return {kind: "start", fromStep: state.step, seedInfo: record.businessInfo};
    return {kind: "start", fromStep: 1, startingNew: true};
  }

  // Nothing to resume: fully onboarded, or KYB has locked the business past editing.
  process.stderr.write(
    state.kind === "locked"
      ? t("businessLocked", {name, status: state.status.replace(/_/g, " ").toLowerCase()})
      : t("businessAlreadyOnboarded", {name})
  );
  const startNew = wantsNew || (interactive && (await confirm({message: t("resumeStartNewConfirm"), default: false})));
  if (!startNew) return {kind: "done", message: t("nothingToDo")};
  return {kind: "start", fromStep: 1, startingNew: true};
}

/**
 * Consent for the Privacy Policy, Terms of Service and marketing updates.
 *
 * Asked as one accept-all question that covers all three, falling back to asking each in turn
 * when it is declined — so a merchant who wants to accept everything answers once, and one who
 * does not still gets to choose per item. Only the Privacy Policy and Terms of Service gate
 * onboarding; marketing stays optional either way, and defaults to off when asked on its own.
 *
 * Returns the marketing preference. The two required ones throw rather than return.
 */
async function collectConsent(args: SignupArgs, interactive: boolean): Promise<boolean> {
  // Without a terminal the acceptance has to be explicit — a generic "skip prompts" flag must not
  // stand in for agreeing to the Privacy Policy and Terms of Service.
  if (!interactive) {
    if (!args.acceptTerms) throw new AtoaError(t("signupNeedsAcceptTerms"), "validation");
    return Boolean(args.marketing);
  }
  if (args.acceptTerms) return Boolean(args.marketing);

  const acceptAll = await confirm({message: t("consentAcceptAll"), default: true});
  if (acceptAll) return true;

  const acceptPrivacy = await confirm({
    message: t("consentPrivacy"),
    default: true
  });
  if (!acceptPrivacy) {
    throw new AtoaError(t("consentPrivacyRequired"), "validation");
  }

  const acceptTos = await confirm({
    message: t("consentTerms"),
    default: true
  });
  if (!acceptTos) {
    throw new AtoaError(t("consentTermsRequired"), "validation");
  }

  return confirm({message: t("consentMarketing"), default: false});
}

/** The onboarding wizard (steps 1–4), run with an authed context. */
async function runOnboarding(ctx: CommandContext, args: SignupArgs): Promise<void> {
  // Every field below resolves from a flag or a prompt, so this runs with or without a terminal;
  // without one, a missing required field fails naming its flag rather than hanging.
  const interactive = isInteractive(ctx.formatExplicit);

  // Decide where to start: an explicit --from-step, or auto-detect an in-progress
  // business and let the user continue it (jump to the first incomplete step) or start over.
  const start = await resolveOnboardingStart(ctx, args);
  if (start.kind === "done") {
    process.stderr.write(start.message + "\n");
    return;
  }
  const fromStep = start.fromStep;
  const startingNewOverExisting = start.startingNew ?? false;

  process.stderr.write(t("onboardingHeading"));

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

  // ── Step 1: Business details (name, industry, turnover, VAT, website, consent) ──
  if (fromStep <= 1) {
    process.stderr.write(t("signupStep1"));

    const legalBusinessName = await resolveField({
      value: args.businessName,
      flag: "business-name",
      message: t("labelBusinessName"),
      rule: validateBusinessName,
      interactive
    });

    // Industry / business type is a server-side lookup (env-specific ids); fetch and pick.
    // Deduplicated by name — the table carries
    // duplicate rows (several literal "New Type" test entries), which otherwise fill the picker.
    const types = (await ctx.http.request({...V1_ROUTES.onboarding.businessTypes})).data as Array<{
      id: string;
      name: string;
    }>;
    let businessType: {id: string; name: string} | undefined;
    if (types.length) {
      const seen = new Set<string>();
      const uniqueTypes = types.filter((t) => !seen.has(t.name) && seen.add(t.name));
      // Searchable: the list is long enough that a plain select is unusable on a TTY.
      const id = await resolveChoice({
        value: args.industry,
        flag: "industry",
        message: t("labelBusinessIndustry"),
        choices: uniqueTypes.map((bt) => ({value: bt.id, name: bt.name})),
        interactive,
        searchable: true
      });
      businessType = uniqueTypes.find((bt) => bt.id === id);
    }

    // Monthly turnover — server-defined bands. The display string itself is what's persisted.
    // Required, and collected in step 1.
    const ranges = (await ctx.http.request({...V1_ROUTES.onboarding.transactionRanges})).data as string[];
    if (ranges.length) {
      businessInfo.averageMonthlyTransaction = await resolveChoice({
        value: args.monthlyTurnover,
        flag: "monthly-turnover",
        message: t("labelMonthlyTurnover"),
        choices: ranges.map((r) => ({value: r, name: r})),
        interactive
      });
    }

    // VAT is required at signup.
    businessInfo.vatNumber = normaliseVatNumber(
      await resolveField({
        value: args.vatNumber,
        flag: "vat-number",
        message: t("labelVatNumber"),
        rule: validateVatNumber,
        interactive
      })
    );

    // Website is optional — blank is sent as undefined (omitted), not an empty string.
    const websiteUrl = (
      (await resolveField({
        value: args.websiteUrl,
        flag: "website-url",
        message: t("labelWebsiteUrlOptional"),
        rule: validateWebsiteUrl,
        interactive,
        optional: true
      })) ?? ""
    ).trim();
    if (websiteUrl) businessInfo.webSiteUrl = websiteUrl;

    const allowMarketingEmails = await collectConsent(args, interactive);

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
      throw new AtoaError(t("createBusinessNoId"), "generic");
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
    process.stderr.write(t("signupStep2"));
    // Product restricts CLI signup to Limited Company + Charity (the backend enum also has
    // SOLE_TRADER — do not re-add without product sign-off).
    const companyType = await resolveChoice({
      value: args.businessStructure,
      flag: "business-structure",
      message: t("labelBusinessStructure"),
      choices: [
        {name: "Limited Company", value: "COMPANY_LTD"},
        {name: "Charity", value: "CHARITY"}
      ],
      interactive
    });
    businessInfo.companyType = companyType;
    await ctx.http.request({...V1_ROUTES.onboarding.updateBusiness, body: {businessInfo}});
    process.stderr.write(t("businessStructureSaved"));
  }

  // ── Step 3: Personal details ─────────────────────────────────────────────
  if (fromStep <= 3) {
    process.stderr.write(t("signupStep3"));
    const firstName = await resolveField({
      value: args.firstName,
      flag: "first-name",
      message: t("labelFirstNamePrompt"),
      default: prefill.firstName,
      rule: validateName("First name"),
      interactive
    });
    const lastName = await resolveField({
      value: args.lastName,
      flag: "last-name",
      message: t("labelLastNamePrompt"),
      default: prefill.lastName,
      rule: validateName("Last name"),
      interactive
    });
    await ctx.http.request({...V1_ROUTES.onboarding.updateProfile, body: {firstName, lastName}});

    // Phone is optional. When supplied, the contact update may require OTP — withOtp handles the
    // "send → prompt → verify" two-step (re-sends the same request with the code).
    const phoneCountryCode = await resolveField({
      value: args.phoneCountryCode,
      flag: "phone-country-code",
      message: t("labelPhoneCountryCodePrompt"),
      default: prefill.phoneCountryCode || DEFAULT_PHONE_COUNTRY_CODE,
      rule: validateCountryCode,
      interactive,
      optional: true
    });
    const phoneNumber = await resolveField({
      value: args.phoneNumber,
      flag: "phone-number",
      message: t("labelPhoneNumberPrompt"),
      default: prefill.phoneNumber,
      rule: validatePhoneNumber,
      interactive,
      optional: true
    });
    // Setting the first number is NOT challenged: the backend only sends a code when REPLACING a
    // number that already exists, and signup's account has none. withOtp stays as the guard for the
    // profile-edit path. --otp is deliberately not passed — it is the email code, and the phone
    // challenge (when it does fire) is a different code sent to the phone.
    if (phoneNumber) {
      const contactBody: Record<string, unknown> = {phoneNumber};
      if (phoneCountryCode) contactBody["phoneCountryCode"] = phoneCountryCode;
      const {otpUsed} = await withOtp(ctx.http, {
        send: V1_ROUTES.onboarding.updateContact,
        verify: V1_ROUTES.onboarding.updateContact,
        body: contactBody,
        interactive,
        onOtpSent: () => process.stderr.write(t("otpSentToPhone"))
      });
      process.stderr.write(otpUsed ? t("phoneVerified") : t("phoneSaved"));
    }

    // Business address (part of businessInfo — resend the full accumulator).
    // Postcode first, then line 1, then line 2 — the order the address is usually looked up in.
    const addressPostalCode = (
      await resolveField({
        value: args.postalCode,
        flag: "postal-code",
        message: t("labelPostalCodePrompt"),
        rule: validatePostcode,
        interactive
      })
    ).toUpperCase();
    const addressLine1 = await resolveField({
      value: args.addressLine1,
      flag: "address-line1",
      message: t("labelBusinessAddressLine1"),
      rule: validateAddress,
      interactive
    });
    const addressLine2 = (
      (await resolveField({
        value: args.addressLine2,
        flag: "address-line2",
        message: t("labelBusinessAddressLine2Optional"),
        rule: validateAddressLine2,
        interactive,
        optional: true
      })) ?? ""
    ).trim();
    businessInfo.addressPostalCode = addressPostalCode;
    businessInfo.addressLine1 = addressLine1;
    if (addressLine2) businessInfo.addressLine2 = addressLine2;
    await ctx.http.request({...V1_ROUTES.onboarding.updateBusiness, body: {businessInfo}});
    process.stderr.write(t("businessContactSaved"));
  }

  // Step 4 ("how did you hear about us" / sourceOfInstall) was removed from the flow and
  // turnover moved up into step 1. The signupSources route record is now unused by this wizard.
  process.stderr.write(t("onboardingComplete"));

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
