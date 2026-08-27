# Changelog

All notable changes to the Atoa CLI are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Accurate failure reporting, and `signup` / `bank add` runnable without a terminal.

### Added

- **A flag for every prompted value on `signup`**, so it can run with no terminal: `--otp`,
  `--accept-terms`, `--marketing`, `--start-new`, and one for each onboarding field. It runs as two
  invocations — the first sends the one-time code, the second carries it plus every value.
  Interactive use is unchanged.
- **`--otp` on `bank add`**, for the one-time code the endpoint can require.
- **Exit code `9`** — a one-time code was sent and nothing was written. Distinct from success
  (`signup` previously reported `0`, claiming an account existed when none did) and from invalid
  input (`bank add` previously reported `3`, sending callers hunting for a bad flag).
- `--start-new` on `signup`, to create a second business rather than resuming an existing one.
  Without it, an unattended re-run resumes or reports "Nothing to do" — it never creates one by
  itself.
- **`--confirm-payee-name` on `bank add`**, for a Confirmation-of-Payee near-match. Without it an
  unattended run now exits `3` quoting the name the bank holds, rather than opening a prompt
  nobody can answer after the one-time code has already been spent. It is deliberately not
  covered by `--yes`.
- **`atoa google`** — `search`, `link`, `unlink` and `locations`, pairing an Atoa store with its
  Google Business listing.

### Changed

- **`bank add` and `keys create` no longer prompt when `--output` is passed.** Both decided this
  from stdin alone, but a prompt is drawn to stdout — so `bank add --output json > file` in a
  terminal wrote the question into the file and appeared to hang. They now use the same rule as
  every other command: prompts only when stdout is a terminal and no `--output` was given.
  A terminal run with an explicit `--output` (including `--output table`, already the default)
  now requires the flags instead of asking for them.
- **`bank add` names the missing flag.** A non-interactive run without `--bank-name`, `--sort-code`
  or `--account-number` now reports which one is missing, instead of one blanket message listing
  all three — and fails before contacting the API rather than after.
- **`bank add` no longer asks about the primary account.** A business's first account becomes its
  primary automatically, matching the dashboard; previously the prompt defaulted to no, so pressing
  Enter — or any non-interactive run — left the business with an account but no primary at all.
  Later accounts are added without being asked. `--setPrimary` is unchanged when passed explicitly.

### Fixed

- **Access refusals no longer advise re-authenticating.** `UNAUTHORIZED_ACCESS`,
  `ROLE_UNAUTHORIZED_ACCESS` and `KYB_VERIFICATION_REQUIRED` arrive as 401/403 but refuse the
  access, not the credential; the CLI advised `atoa login`, which for the first mints an identical
  token and fails identically.
- **OTP throttles are reported as rate limits, not auth failures.** The wrong-code lockout was
  treated as a retryable typo, so the CLI re-prompted for a code that could never be accepted,
  spending the remaining attempts.
- **A lockout now outranks the code it arrives with.** When a response carried a wrong-code marker
  *and* lockout wording together, the wrong-code reading won and the CLI kept retrying into the
  block. Such a response now exits `5` where it previously exited `3` — callers branching on that
  path should expect the change. An ordinary wrong code is unaffected and still exits `3`.
- **A sign-in cooldown is reported as a rate limit, not an auth failure.** After repeated failed
  attempts the backend locks sign-in and answers 401; the CLI printed "run `atoa login`" underneath
  a message saying to wait N seconds — recommending the exact action that caused the lockout. This
  is a distinct failure mode from the OTP throttles, and is now matched by its error code rather
  than by its wording.
- **A 401 answered after the backend had already acted is no longer replayed**, which was sending a
  second one-time code.
- **`--otp` no longer triggers a fresh code before submitting.** The initial probe request is what
  makes the backend send one, so the supplied code was invalidated before use — and on production,
  where codes are random, it would have failed every time.
- An expired OTP is no longer retried: expiry is only raised for a code that matched, so retyping
  it re-fails identically.
- Re-running `signup` against a fully-onboarded business no longer waits on a prompt that cannot be
  answered without a terminal.
- An unrecognised `--output` value now exits `3` rather than `1`.
- `--industry`, `--monthly-turnover` and `--business-structure` accept the option's name, and an
  unmatched value lists every valid option instead of failing opaquely.

### Documentation

- Exit codes `7`, `8` and `9` added to the README table (`7` and `8` were missing).
- Corrected the `custom-sms` sender-name rule: 3–11 characters, letters, numbers **and spaces** —
  it was documented as letters and numbers only.

## [0.3.0] - 2026-08-20

Business-settings commands, in-place editing, and table output by default.

### Added

- **Add-on plans** (`atoa addons`): `list` shows the current plan, feature usage and the plans you
  can move to; `upgrade`, `downgrade` and `cancel-downgrade` change it. A refused downgrade names
  the features that exceed the target plan's limits.
- **Direct Debit** (`atoa direct-debit`): `status` and `setup` for the subscription mandate. A
  business can hold one mandate — `setup` refuses rather than creating a second.
- **Notification preferences** (`atoa comms`): `list` shows each topic with its per-channel state;
  `set <topic> --email|--sms|--push on|off` toggles them.
- **Checkout branding** (`atoa custom-branding get/set/reset`) and **SMS sender name**
  (`atoa custom-sms list/set/delete`).
- **Card-payment activation status** (`atoa kyb card status`, `atoa kyb card link`), including what
  is blocking activation when verification hasn't passed.
- **Full staff, role and store management**: `staff add/update/delete`, `roles add/update/delete`,
  `stores add/update`.
- **In-place editing**: run an `update` command on a terminal and every field is offered with its
  current value already filled in — press Enter to keep it, type over it to change it.
- **Permission prerequisites**: selecting a permission that depends on others grants them
  automatically and prints which extras were added.

### Changed

- **Default output is a table.** Values that don't fit wrap inside their cell rather than being
  truncated, and an empty value shows as `N/A`. `--output json|yaml` is unchanged.
- **List output is projected, not raw.** `staff`, `roles`, `stores` and `comms` return readable
  columns instead of nested records — roles show permission names, staff show their permitted
  store names, and comms shows one column per channel.
- **`atoa get`, `atoa post` and `atoa delete` authenticate with the SDK key**, not the browser
  session. Run `atoa keys create` before using them.
- **`atoa branding` is now `atoa custom-branding`**, and **`atoa sms` is now `atoa custom-sms`**.
- **`atoa staff invite` is an alias of `atoa staff add`** — one implementation behind both names,
  so they validate and prompt identically.
- Field validation and error messages now match the merchant dashboard.

### Removed

- **`atoa google-review`**.
- **`atoa kyb card submit`** — card activation is read-only from the CLI; apply via
  `atoa kyb card link`.
- **`--open` on `atoa kyb link`** — the command now always opens the browser, and still prints
  the URL so there is a fallback when no browser can be launched.

### Fixed

- An add-on plan limit (HTTP 403) was reported as an authentication failure telling you to run
  `atoa login`. It now exits with its own code (8) and points at `atoa addons`.
- `atoa staff delete` removed the wrong record for some accounts.
- The browser failed to open on Windows for `atoa login` and the KYB deep-links; the URL was
  printed but never navigated to.
- Long values such as IDs were silently truncated in table output.
- **`atoa bank add` sent two OTPs per run.** The bank endpoint answers 401 for business outcomes —
  OTP required, wrong code, throttled — and each was mistaken for an expired token, refreshed and
  replayed, re-sending the request. Against a two-per-minute allowance that made the command
  unusable: it reported "maximum number of OTP requests" before ever prompting for a code.
- A mistyped OTP allowed one attempt instead of five, and reported the typo as an authentication
  failure advising `atoa login`. The bank flow rejects a bad code with 401 where onboarding uses
  400, and only 400 was treated as retryable.
- `atoa direct-debit setup` never prefilled the billing address. It read `businessInfo` one level
  too high in the response, which silently yielded nothing.
- `atoa bank list` and `atoa bank get` printed the full account number, and the IBAN containing
  it, whenever output was piped or `--output` was given. Both now show only the masked number.
- `atoa addons list` now shows usage against the plan's limit (`1 / 1`, `(unlimited)`,
  `(not in this plan)`), so a plan-limit refusal can be understood without guesswork.

[0.3.0]: https://github.com/ATOAPaymentsLimited/Atoa-CLI/releases/tag/v0.3.0

## [0.2.0] - 2026-06-29

Browser-based JWT login and the v1 account-management command set.

### Added

- **Browser (PKCE) login** (`atoa login`): opens the Atoa dashboard grant page, captures the
  one-time code on a `127.0.0.1` loopback server, and exchanges it server-side for a JWT
  access + refresh pair. No tokens ever touch your shell history.
- **In-CLI signup** (`atoa signup`): create an account with email + OTP, then run the onboarding
  wizard (business details, contact, transaction ranges).
- **v1 account-management commands**: `business`, `bank`, `kyb`, `keys` (create/list/regenerate/
  revoke), `payment-links`, `roles`, `sessions`, `staff`, `stores`.
- **Windows credential hardening**: files under `~/.atoa/auth/` are locked to the current user via
  `icacls` (stripped inheritance, owner-only). POSIX continues to use `0600`.

### Changed

- **`atoa login` is env-independent** — the `--env` flag has been removed. The browser grant
  authenticates against a single auth backend, so one JWT session per profile works for
  both sandbox and production. `defaultEnv` now only decides which env the SDK/data commands target.
- **`atoa logout` is env-agnostic** — it clears the profile's JWT session wholesale. `--purge-key`
  removes the profile's SDK keys (every env, or one scoped via `--env`).
- **`atoa profile set env=<env>`** no longer requires pre-existing credentials for that env; it just
  records the default env for SDK/data commands.
- Credentials are stored in owner-only (`0600`) JSON files under `~/.atoa/auth/` — `session.json`
  (JWT pair, keyed by profile) and `secret_key.json` (SDK keys, keyed by profile + env).

### Removed

- **OS keychain backend** — credentials are now plain files by design (like the AWS / gcloud /
  Stripe CLIs) so automation and coding agents on the same machine can read them.
- **Legacy `--token` / `--stdin` paste login flow** — browser login is the only sign-in path. There
  is no headless/CI login; provision credentials on a workstation and expose `~/.atoa/auth/` to the
  runner via `ATOA_HOME`.
- **Paste-and-store SDK-key fallback** — SDK keys must be minted explicitly with `atoa keys create`
  so they always carry a revocable `sdkAccessId` (a pasted secret has none and could never be
  revoked from the CLI).

### Security

- TLS 1.3 minimum with pinned ciphers; `NODE_TLS_REJECT_UNAUTHORIZED=0` is rejected at startup.
- The dashboard grant URL is https-validated, with a loopback-only dev exception gated on
  `ATOA_ALLOW_INSECURE=1`.
- The loopback callback validates `state` before every other branch (CSRF), binds to `127.0.0.1`
  only, is single-shot, and serves fully self-contained pages (no third-party font/logo beacons).

[0.2.0]: https://github.com/ATOAPaymentsLimited/Atoa-CLI/releases/tag/v0.2.0
