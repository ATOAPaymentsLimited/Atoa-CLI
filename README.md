# Atoa CLI

First-party command-line interface for the [Atoa](https://paywithatoa.co.uk) payment API. Manage merchants, payments, refunds, webhooks, bank feeds, and payouts from your terminal — scriptable, secure, and consistent across `sandbox` and `production`.

**Documentation:** [Atoa Docs](https://docs.atoa.me/cli)

```bash
atoa login                                  # pair this machine with your Atoa account
atoa payments create --amount 10.05 --orderId order-001 --customerId cust_123
atoa webhooks trigger PAYMENTS_STATUS       # fire a fake event at your sandbox URL
```

---

## Install

```bash
npm install -g @atoapayments/atoa-cli
```

**Requires Node.js 20 or later** (`node --version`).

Verify:

```bash
atoa --version
```

### Sandbox vs production

The same binary talks to both `sandbox` and `production`. Pick which env a command targets via `--env`, or set a default per profile (`atoa profile set env=production`). Pairing a token to the wrong env surfaces as `401` on the first authenticated call — run `atoa whoami` to confirm which env you're authenticated against.

---

## Quick start

```bash
# 1. Log in via your browser (recommended)
atoa login

# 2. Confirm
atoa whoami

# 3. Try a real call
atoa stores list
atoa payments create --amount 10.05 --orderId test-001 --customerId cust_123 --redirectUrl https://example.com
```

Credentials are stored in owner-only (`0600`) JSON files under `~/.atoa/auth/` — JWT sessions in `session.json`, SDK API keys in `secret_key.json`. Plain files (no OS keychain, like the AWS/gcloud/Stripe CLIs) so automation and coding agents on the same machine can read them. **Credentials never touch a `.env` file or your shell history.**

---

## Profiles & environments

A single machine can hold credentials for **many merchants** (profiles) **and** both environments (`sandbox` + `production`). The CLI keeps them isolated so production keys can't run during a test session by accident. Note: each binary talks to one server, so a credential's reachability still depends on which build you installed (see above).

```bash
atoa profile list                  # see every profile + which envs are configured
atoa profile show                  # detailed metadata for the active profile
atoa profile use acme              # switch active profile
atoa profile set env=production    # set the default env for the active profile (prompts)
atoa profile rename acme acme-uk   # rename + move the stored credentials
atoa profile delete old-merchant   # remove profile + its JWT session and SDK keys
atoa whoami --env production       # query against a specific env without switching the default
```

> Browser login (`atoa login`) is **env-independent** — one JWT session per profile works for both
> sandbox and production. `defaultEnv` only decides which env SDK/data commands target by default.

---

## Sign in

### Browser flow (recommended)

```bash
atoa login      # opens the Atoa dashboard grant page in your default browser
```

`atoa login` takes no `--env`: the browser grant authenticates against a single auth
backend, so the resulting JWT session works for both sandbox and production. The profile is not
env-scoped.

What happens:

1. The CLI generates a PKCE pair and a random state value, then starts a temporary localhost server on a random port.
2. Your default browser opens the Atoa dashboard grant page (`/auth/extension-callback`).
3. You approve the request in the browser.
4. The dashboard redirects back to `http://127.0.0.1:<port>/callback` with a one-time code.
5. The CLI exchanges the code for a JWT access token + refresh token (server-side PKCE verification).
6. If your account belongs to multiple businesses, you are prompted to pick one (interactive terminals only; non-interactive logins complete and ask you to run `atoa business use <id>` afterwards).
7. A profile is created (or updated) and the JWT pair is stored in `~/.atoa/auth/session.json` (owner-only, `0600`).

`atoa login` requires an interactive terminal (TTY) and a desktop browser on the same machine — there is no headless/CI login path. For CI, provision credentials on a workstation and make the `~/.atoa/auth/` files available to the runner (see [CI / automation](#ci--automation)).

### Minting an SDK key

To use the SDK/data commands (`payments`, `refunds`, …) you need an SDK API key. Create one
explicitly after logging in:

```bash
atoa keys create --env sandbox    # mints a revocable SDK key, writes it to secret_key.json
```

The `apiSecret` is shown **once** — save it immediately. Requires an admin role on the business.

---

## Dual-credential model

The CLI supports two independent credential types per profile and environment:

```
atoa login (browser)
      │
      ├─► JWT access token  ──► account-management commands (v1 API)
      │   JWT refresh token      business, sessions, keys, staff, roles,
      │                          kyb, payment-links, bank, stores,
      │                          addons, comms, custom-branding,
      │                          custom-sms, direct-debit
      │
      └─► SDK API key (optional, via `atoa keys create`)
              ──► payments/data commands (legacy API)
                  payments, refunds, customers, card-on-file,
                  webhooks, bank-feed, payouts, institutions,
                  get, post, delete
```

A single `atoa login` always mints a JWT pair. The SDK key is optional and can be added at any time with `atoa keys create`.

Credentials live in two owner-only (`0600`) JSON files under `~/.atoa/auth/`:

| File | Content | Keyed by |
|---|---|---|
| `session.json` | JWT access + refresh tokens (browser login) | profile only — env-independent, since browser login hits one auth backend |
| `secret_key.json` | SDK API keys (`atoa keys create`) | profile + env |

### Which commands need which login

| Auth required | Commands |
|---|---|
| **JWT (browser login)** | `business list/use`, `sessions list/revoke`, `keys create/list`, `kyb status/link`, `kyb card status/link`, `staff *`, `roles *`, `payment-links create/get/delete`, `bank list/get/add/delete`, `stores *`, `addons *`, `comms list/set`, `custom-branding get/set/reset`, `custom-sms list/set/delete`, `direct-debit status/setup` |
| **SDK key** (`atoa keys create`) | `payments *`, `refunds *`, `customers *`, `payment-methods *`, `card-on-file *`, `webhooks *`, `bank-feed *`, `payouts *`, `institutions list`, `get`, `post`, `delete` |
| **Either** | `whoami`, `keys revoke/regenerate` |
| **None** (self-authenticating) | `signup` (creates the account + session itself), `completion`, `profile *`, `reset` |

Commands that require JWT will error with a clear message when the active profile has only an SDK key and no JWT session. Run `atoa login` (browser) to gain a JWT session; mint an SDK key with `atoa keys create` when you need the SDK/data commands.

---

## New commands reference

### Account management (`business`, `sessions`)

```bash
atoa business list                      # list businesses on this account; marks the active one
atoa business use <businessId>          # switch the active business for /v1 API calls
atoa sessions list                      # list active CLI sessions for this account
atoa sessions revoke <deviceId>         # revoke a session (--yes to skip confirmation)
```

### SDK key management (`keys create`, `keys list`)

These extend the existing `keys revoke` / `keys regenerate` commands.

```bash
atoa keys create                        # create a new SDK API key (jwt mode; prompts for a label)
atoa keys create --name "CI server"     # label the key non-interactively
atoa keys list                          # list SDK keys for this account (never shows secrets)
```

### KYB (`kyb`)

```bash
atoa kyb status                         # get the KYB verification status for this business
atoa kyb link                           # open the KYB form in the browser (prints the URL too)
atoa kyb card status                    # card-payment application status + what blocks it
atoa kyb card link                      # open the card-payment application form
```

### Staff and roles (`staff`, `roles`)

`staff add` and `staff invite` are the same command under two names. Omit the identifier on a
TTY and the CLI prompts, prefilled with the record's current values.

```bash
atoa staff list                         # list staff members for this business
atoa staff add \
  --firstName Alice --lastName Smith \
  --email alice@example.com \
  --role <roleId>                       # add a new staff member
atoa staff add … --store <storeId>      # restrict to one or more stores (repeatable flag)
atoa staff update <userId>              # edit name, email, phone, role or permitted stores
atoa staff delete <userId> --yes        # remove a staff member from the business
atoa roles list                         # list available roles for this business
atoa roles add --name "Shift lead"      # create a role; prompts for permissions
atoa roles update <roleId>              # edit name, description or permissions
atoa roles delete <roleId> --yes        # delete a role
```

Permissions can depend on other permissions. Selecting one automatically grants what it
requires, and the CLI prints which extras it added.

### Bank accounts (`bank`)

```bash
atoa bank list                          # list bank accounts for the active business
atoa bank add                           # interactive: pick bank, enter details, verify via OTP
atoa bank add --sortCode 040004 --accountNumber 12345678 \
  --accountHolderName "Acme Ltd"

# Non-interactive. If a one-time code is required, the first run exits 9 having sent it:
atoa bank add --bankName "Acme Bank" --sortCode 040004 \
  --accountNumber 12345678 --accountHolderName "Acme Ltd" --output json
#   → exit 9: "An OTP was sent to your registered contact. Re-run with --otp <code>"
atoa bank add ...same flags... --otp 123456 --output json    # → exit 0
atoa bank get <bankAccountId>           # get a bank account by id
atoa bank delete <bankAccountId> --yes  # remove a bank account
```

A business's first bank account becomes its primary automatically. `--setPrimary` switches which
account Atoa settles to and re-points every location already linked to one, so pass it only when
you mean to change the billing account.

### Payment links (`payment-links`)

`--amount` is in GBP (e.g. `10.50`), not pence. `--store-id` is required.

```bash
atoa payment-links create --amount 10.50 --store-id <id>                  # create a link
atoa payment-links create --amount 10.50 --store-id <id> --notes "Inv 42" # notes max 30 chars
atoa payment-links get <linkId> --store-id <id>                           # fetch a link + status
atoa payment-links delete <linkId> --store-id <id>                        # delete a link
```

### Stores (`stores`)

```bash
atoa stores list                        # list stores for this business
atoa stores get <storeId>               # get a store by ID
atoa stores add                         # interactive: name, address, postcode
atoa stores add --locationName "Soho" --addressLine1 "12 Dean St" \
  --cityOrTown London --addressPostalCode W1D3RP
atoa stores update <storeId>            # prompts with the store's current values prefilled
atoa stores link-bank <storeId> --bank <bankAccountId>  # link a bank account to a store
atoa stores image ./logo.png --storeId <storeId>        # upload/replace store logo (PNG/JPG, ≤6MB)
```

### Add-on plans (`addons`)

```bash
atoa addons list                        # current plan, feature usage, available moves
atoa addons upgrade                     # pick a plan on a TTY, or pass a plan ID
atoa addons downgrade <planId>          # refused while usage exceeds the target plan
atoa addons cancel-downgrade            # cancel a downgrade that hasn't taken effect
```

A refused downgrade names the features that are over the target plan's limits, so you know
what to reduce before retrying.

### Direct Debit (`direct-debit`)

A business can hold one mandate. Once it's active, `setup` refuses rather than creating a second.

```bash
atoa direct-debit status                # whether a mandate exists, and its status
atoa direct-debit setup                 # interactive: bank details + billing address
```

Interactive setup prefills the account holder name, email and billing address already held on
the business, and masks the account number on file — press Enter to keep it.

### Notification preferences (`comms`)

```bash
atoa comms list                         # topics, with each channel's state
atoa comms set payouts --email off      # topic ID or display name
atoa comms set <topicId> --sms on --push off
```

Each channel reads `on`, `off`, or `unavailable` — Atoa doesn't send every channel for every
topic, and an unavailable channel can't be switched on.

### Checkout branding and SMS sender name (`custom-branding`, `custom-sms`)

```bash
atoa custom-branding get                # current checkout theme colour
atoa custom-branding set '#FF0000'      # 6-digit hex
atoa custom-branding reset              # restore the Atoa default

atoa custom-sms list                    # sender name and its review status
atoa custom-sms set AcmeLtd             # request a sender name (3-11 chars; letters, numbers, spaces)
atoa custom-sms delete --yes            # remove the custom sender name
```

### Merchant onboarding (`signup`)

`atoa signup` needs **no prior login** — it creates the account (email + one-time code) and its JWT session, then runs the onboarding wizard.

```bash
atoa signup                             # interactive: email + OTP, then guided onboarding
atoa signup --email you@example.com     # skip the email prompt
atoa signup --fromStep 2                # resume from step N (2-3); businessId must already be set
atoa signup --deviceName "Work laptop"  # label this device in your Atoa sessions
```

Every prompted value also has a flag, so signup can run with no terminal at all. The one-time code
goes to your inbox, so it takes two runs:

```bash
atoa signup --email you@example.com --output json
#   → exit 9: "An OTP has been sent to you@example.com."

atoa signup --email you@example.com --otp 123456 --accept-terms \
  --business-name "Acme Ltd" --industry "Retail - Other" \
  --monthly-turnover "Up to £10,000" --business-structure "Limited Company" \
  --vat-number 123456789 --first-name Ada --last-name Lovelace \
  --postal-code "SW1A 2AA" --address-line1 "10 Downing Street" --output json
```

`--accept-terms` records acceptance of the [Privacy Policy](https://paywithatoa.co.uk/atoa-business-privacy-policy/)
and [Terms of Service](https://paywithatoa.co.uk/terms/); `--marketing` is a separate opt-in.
`--start-new` creates a second business rather than resuming an existing signup.

`--business-structure` is `Limited Company` or `Charity`. `--industry` and `--monthly-turnover` are
server-defined lists that vary by environment, so the values above are illustrative — pass the
option's name and, if it doesn't match, the CLI exits `3` listing every valid one to choose from.

---

## Idempotency-Key — duplicate-charge protection

The CLI auto-generates a fresh `Idempotency-Key: <uuidv4>` header on every POST/PUT/PATCH. The Atoa server uses it to deduplicate retries, so a network blip on the response never produces a doubly-charged customer.

You don't need to think about this for interactive use — it just works. For **CI / scripted retries**, where one logical operation spans multiple CLI invocations (e.g. the job restarts), pass `--idempotencyKey` so a re-run produces the same key and the server deduplicates:

```bash
# Auto-generated key (default — safe for interactive use)
atoa refunds create --paymentRequestId pr_abc --amount 5.00

# Stable key (CI retry-safe — same key on every re-run of the same run)
atoa refunds create \
  --paymentRequestId pr_abc \
  --amount 5.00 \
  --idempotencyKey "atoa-cli/refund/${RUN_ID}/${PAYMENT_ID}"
```

Available on `atoa payments create`, `atoa refunds create`, `atoa card-on-file charge`, and the generic `atoa post`. For other POST endpoints, the auto-generated key is always sent — your retries are safe by default.

---

## Common workflows

### Payments

```bash
atoa payments create --amount 25.00 --orderId order-001 --customerId cust_123 --redirectUrl https://shop.example.com/return
atoa payments status pr_abc123 --poll
atoa payments cancel pr_abc123 --yes
atoa payments transactions --from 2026-01-01 --to 2026-01-31 --status COMPLETED
atoa payments transactions --pageAll --output json   # walk every page
```

### Customers & saved cards

```bash
atoa customers create --fullName "Jane Doe" --email jane@example.com --type INDIVIDUAL
atoa customers list --search jane
atoa customers get cust_123
atoa customers update cust_123 --vatNumber GB123456789
atoa customers delete cust_123 --yes
atoa payment-methods list --customer cust_123
atoa payment-methods get card_456 --customer cust_123
atoa payment-methods delete card_456 --customer cust_123 --yes
```

### Card-on-file (saved card charging)

```bash
atoa card-on-file charge --customerId cust_123 --paymentMethodId card_456 --amount 10.50 --orderId order-007
atoa card-on-file charge --customerId cust_123 --paymentMethodId card_456 --amount 10.50 --orderId order-007 --captureType MANUAL_CAPTURE
atoa card-on-file capture pr_abc123 --yes
atoa card-on-file cancel pr_abc123 --yes
```

### Refunds

```bash
atoa refunds create --paymentRequestId pr_abc123 --amount 5.00 --currency GBP --notes "duplicate charge" --yes
atoa refunds list --paymentRequestId pr_abc123
atoa refunds cancel rf_xyz --yes
```

### Webhooks

```bash
atoa webhooks create --url https://your-app.com/webhooks --event PAYMENTS_STATUS
atoa webhooks create --url https://your-app.com/webhooks --event PAYMENTS_STATUS \
  --authentication @./auth.json                              # OAuth/Basic secret from file (NOT inline — see below)
atoa webhooks list
atoa webhooks delete wh_123 --yes
```

> ⚠ Pass authentication secrets via `--authentication @path/to/auth.json` (or `--authentication -` for stdin). Inline JSON (`--authentication '{"clientSecret":"..."}'`) is accepted but **exposes the secret in `ps`, shell history, and audit logs** — avoid in scripted use.

#### Webhook test trigger (sandbox only)

`atoa webhooks trigger` fires a fake event at your registered sandbox webhook URL — same body shape and signature recipe as a production event, no real payment needed. Always uses the sandbox key, regardless of `--env`.

Supported events: `PAYMENTS_STATUS`, `EXPIRED_STATUS`, `REFUND_STATUS`, `POS_PAYMENT_STATUS`.

```bash
# Defaults — fires a PAYMENTS_STATUS event with a generated orderId
atoa webhooks trigger PAYMENTS_STATUS

# Override fields in the dispatched body
atoa webhooks trigger PAYMENTS_STATUS --paymentMethod CARD --status AUTHORIZED
atoa webhooks trigger PAYMENTS_STATUS --orderId order-001 --amount 25.00
atoa webhooks trigger REFUND_STATUS --status FAILED

# POS_PAYMENT_STATUS has multiple body shapes — pick one via --type
atoa webhooks trigger POS_PAYMENT_STATUS --type PAYMENTS_STATUS
atoa webhooks trigger POS_PAYMENT_STATUS --type REFUND_STATUS --status COMPLETED
atoa webhooks trigger POS_PAYMENT_STATUS --type EXPIRED_STATUS
atoa webhooks trigger POS_PAYMENT_STATUS --type PAYMENTS_STATUS \
  --customFields '[{"value":"CUST_001","fieldName":"Customer ID"}]'
```

| Flag | Use |
|---|---|
| `--orderId` | Override the dispatched body's `orderId` |
| `--amount` | Override `paidAmount` in pounds (e.g. 10.05 for £10.05) |
| `--paymentMethod` | `CARD` \| `PAY_BY_BANK` |
| `--status` | `COMPLETED` \| `AUTHORIZED` \| `FAILED` \| `CANCELLED` \| `EXPIRED` (per-event validation server-side) |
| `--type` | `POS_PAYMENT_STATUS` only — body shape: `PAYMENTS_STATUS` (default) / `REFUND_STATUS` / `EXPIRED_STATUS` |
| `--customFields` | `POS_PAYMENT_STATUS` only — JSON array of `{value, fieldName}` |

### Bank feed (Open Banking)

```bash
atoa bank-feed initiate --redirectUrl https://example.com/bank/return
atoa bank-feed accounts auth_999
atoa bank-feed account acct_111
atoa bank-feed balance acct_111
atoa bank-feed transactions acct_111 --from 2026-01-01 --before 2026-02-01
atoa bank-feed revoke --accountAuthId auth_999 --yes
```

### Stores, institutions, payouts

```bash
atoa stores list
atoa institutions list
atoa payouts list --fromDate 2026-01-01 --status COMPLETED
atoa payouts transactions po_555 --pageAll
```

### Device keys (rotate / revoke)

```bash
atoa keys revoke                              # interactive: picks env if profile has both
atoa keys revoke --env sandbox --yes          # non-interactive
atoa keys revoke <sdkAccessId> --yes          # revoke a specific key by id
atoa keys regenerate                          # rotate active env's key — new bearer shown ONCE
atoa keys regenerate --env production --yes
```

### Generic HTTP verbs (escape hatch)

For endpoints the CLI doesn't yet wrap, or when you want explicit control. These authenticate
with the **SDK key**, so `atoa keys create` must have been run first:

```bash
atoa get /api/payments/stores
atoa get /api/customers -d page=0 -d size=20 --pageAll
atoa post /api/something --data @body.json
atoa post /api/something --data @body.json --idempotencyKey "ci-${RUN_ID}"
atoa delete /api/customers/cust_123 --yes
```

---

## Common flags

### Resource commands (payments, refunds, customers, …)

All resource commands accept the same six globals. Use them on any leaf command in the resource topics (`payments`, `refunds`, `customers`, `payment-methods`, `card-on-file`, `webhooks`, `bank-feed`, `payouts`, `stores`, `institutions`, `keys`, `whoami`, `get`/`post`/`delete`).

| Flag | Use |
|---|---|
| `--env` | Override env (`sandbox` \| `production`) for this single command |
| `--output` | `json` \| `table` \| `yaml` (default: json) |
| `--verbose` | Print method, URL, and redacted Authorization to stderr |
| `--dryRun` | Resolve the request and print it without sending |
| `--yes` | Skip confirmation prompts (required for destructive commands in CI) |
| `--profile` | Operate against a specific profile (overrides `activeProfile`) |

### Admin commands (login, logout, reset, profile/\*)

These don't accept the resource-command globals — they have their own focused arg set. The most common ones:

| Command | Key flags |
|---|---|
| `atoa login` | `--profile` |
| `atoa logout` | `--env`, `--profile`, `--revoke`, `--yes`, `--dryRun` |
| `atoa reset` | `--revoke`, `--yes`, `--dryRun` |
| `atoa profile set` | `--profile`, `--yes`, `--dryRun` (and the `key=value` positional) |
| `atoa profile delete` | `--yes`, `--dryRun` |
| `atoa profile use` | `--dryRun` |
| `atoa profile rename` | `--yes`, `--dryRun` |

Run `atoa <command> --help` for the full per-command flag list.

---

## Output formats

```bash
atoa payments transactions --output json   # default — JSON to stdout
atoa profile list --output table           # human-readable
atoa whoami --output yaml
```

JSON is the default whether or not stdout is a TTY, so piping to `jq` always works without explicit `--output json`.

---

## Shell completion

The CLI ships TAB-completion for command names, flag names, and dynamic values (live profile names, sdkAccessIds, `--env` values). One install per shell:

```bash
atoa completion <bash|zsh|pwsh>
```

| Shell | One-line install |
|---|---|
| **bash** | `atoa completion bash >> ~/.bashrc && source ~/.bashrc` |
| **zsh** | `atoa completion zsh > ~/.zsh/completions/_atoa` (ensure `fpath` includes that dir above `compinit`) |
| **PowerShell** | `atoa completion pwsh \| Out-String \| Invoke-Expression` (append to `$PROFILE` to persist) |

After installing, hit `<TAB>`:

```
atoa <TAB>                       → login, keys, profile, payments, …
atoa keys revoke <TAB>           → your live sdkAccessIds
atoa profile use <TAB>           → your live profile names
atoa --env <TAB>                 → sandbox, production
```

**TAB falls back to file completion?** The wrapper didn't load. Verify the engine first:

```bash
atoa --complete-bash "atoa profile use "
```

If that prints candidates, the engine is healthy — re-run the install in a fresh terminal.

---

## Config / environment variables

| Variable | Purpose |
|---|---|
| `ATOA_HOME` | Override the config + credentials location. Defaults to `$HOME`; credentials land in `$ATOA_HOME/.atoa/auth/`. Useful for Docker, sandboxed CI, ephemeral containers. |
| `ATOA_PROFILE` | Default profile name. Equivalent to passing `--profile <name>` on every command; the explicit flag still wins. Useful for `export ATOA_PROFILE=ci && atoa …` long-running scripts. |
| `ATOA_BASE_URL` | Unchanged — overrides the Atoa payment API base URL at runtime. |
| `ATOA_DASHBOARD_URL` | Override the dashboard URL used for the browser login grant page (build define default: `https://dashboard.paywithatoa.co.uk`). Set at build time via the `DASHBOARD_URL` tsup define or at runtime via this variable. Useful for self-hosted or staging dashboard deployments. |

---

## Exit codes

The CLI uses POSIX-style exit codes so shell pipelines and CI systems can branch on the failure mode:

| Code | Meaning | Trigger |
|---:|---|---|
| `0` | Success | Command completed without error |
| `1` | Generic failure | Anything not classified below |
| `2` | Auth / forbidden | HTTP 401 or 403 — token invalid / revoked / lacks permission |
| `3` | Validation error | HTTP 400, or client-side input rejected (bad amount, bad JSON, bad enum) |
| `4` | Not found | HTTP 404 — resource doesn't exist on this env |
| `5` | Rate limited | HTTP 429 — back off and retry |
| `6` | Network / TLS / DNS | Couldn't reach the server (connection refused, DNS, cert expired, timeout) |
| `7` | Business not selected | The account belongs to several businesses and none is active — run `atoa business use <id>` |
| `8` | Plan limit | The add-on plan doesn't allow this — `atoa addons list` shows the limits |
| `9` | One-time code sent | Not a failure: a code was sent and nothing was written. Re-run the same command with `--otp <code>` |

Example CI pattern:

```bash
if ! atoa refunds create --paymentRequestId "$PR" --amount 5.00 --idempotencyKey "$RUN_ID" --yes ; then
  case $? in
    2) echo "Token invalid — re-login required" ;;
    3) echo "Bad input — fix the payload" ;;
    5) echo "Rate limited — retry with backoff" ;;
    6) echo "Network blip — retry the same idempotency key is safe" ;;
    *) echo "Unhandled error" ;;
  esac
  exit 1
fi
```

---

## CI / automation

`atoa login` needs an interactive browser, so a CI runner can't log in itself. Provision credentials on a workstation (`atoa login`, plus `atoa keys create` if the job hits SDK/data commands), then make the `~/.atoa/auth/` files available to the runner — point `ATOA_HOME` at the directory that holds them.

```bash
# 1. With credentials already provisioned (ATOA_HOME → the auth dir),
#    target the CI profile with a stable idempotency key
atoa --profile ci payments create \
  --amount 10.00 --orderId "$RUN_ID" --customerId cust_123 --redirectUrl https://x \
  --idempotencyKey "ci-payment/$RUN_ID" --dryRun

# 2. Read-only checks
atoa --profile ci payments transactions --output json --status COMPLETED

# 3. Clean up (revokes the server-side key too; safe to share across machines)
atoa logout --profile ci --revoke --yes
```

Key patterns:

- **`--profile ci`** scopes every command to a named credential bundle. Same flag form as `ATOA_PROFILE=ci`.
- **`--idempotencyKey "ci-…/$RUN_ID"`** ensures a re-run of the same CI job doesn't create duplicate payments / refunds / charges.
- **`--dryRun`** lets the CI step validate the resolved request body before going live.
- **`--yes`** skips confirmation prompts — required on every destructive command in non-TTY contexts.

---

## Troubleshooting

### `HTTP 401` after login
Your session may have expired or been revoked (e.g. a later login on the same device evicted it). Run `atoa whoami` to check the active profile, then re-run `atoa login` to refresh the session.

### `No profile is configured. Run \`atoa login\` to pair this device.`
First-run state. Run `atoa login` to pair.

### `Multiple profiles are configured (a, b, c). Run \`atoa profile use <name>\` …`
You have several merchants paired and haven't set a default. Either `atoa profile use <name>` once, or pass `--profile <name>` per command.

### `Timed out acquiring lock on …/session.json.lock`
Another `atoa` process is mid-write. If no other process is running (e.g. one crashed), remove the lockfile manually:

```bash
rm ~/.atoa/auth/session.json.lock
```

### `Refusing to read …/session.json: insecure permissions` (POSIX only)
The session file got group/other read bits. Fix:

```bash
chmod 600 ~/.atoa/auth/session.json
```

### `Refusing to parse …/session.json: not valid JSON`
The file got corrupted. Recover with:

```bash
atoa reset --yes && atoa login
```

---

## Documentation

- **Full docs:** [Atoa Docs](https://docs.atoa.me/cli)
- **Built-in help:** `atoa --help`, `atoa <command> --help`, `atoa <command> <subcommand> --help` — full per-command flag list, always in sync with the binary you have installed.
- **API reference:** see the doc site link from your Atoa Dashboard.

---

## Reset / uninstall

```bash
atoa reset --yes                     # wipe local profiles + tokens (local only)
atoa reset --revoke --yes            # also revoke server-side keys (best-effort)
atoa reset --dryRun                  # preview what would be cleared without touching state
npm uninstall -g @atoapayments/atoa-cli   # remove the binary
```

---

## Support

`hello@paywithatoa.co.uk` or use chat on the [Dashboard](https://dashboard.paywithatoa.co.uk/).
