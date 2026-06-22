# Atoa CLI

First-party command-line interface for the [Atoa](https://paywithatoa.co.uk) payment API. Manage merchants, payments, refunds, webhooks, bank feeds, and payouts from your terminal — scriptable, secure, and consistent across `sandbox` and `production`.

```bash
atoa login                                  # pair this machine with your Atoa account
atoa payments create --amount 10.05 --orderId order-001
atoa webhooks trigger PAYMENTS_STATUS       # fire a fake event at your sandbox URL
```

---

## Install

```bash
npm install -g @ATOAPaymentsLimited/atoa-cli
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
atoa login --env sandbox

# 2. Confirm
atoa whoami

# 3. Try a real call
atoa stores list
atoa payments create --amount 10.05 --orderId test-001 --redirectUrl https://example.com
```

Credentials are stored in your OS keychain (Keychain on macOS, Credential Manager on Windows, libsecret on Linux). When no system keychain is available (Docker, headless CI), they fall back to a `0600`-mode JSON file at `~/.config/atoa/secrets.json`. **Credentials never touch a `.env` file or your shell history.**

---

## Profiles & environments

A single machine can hold credentials for **many merchants** (profiles) **and** both environments (`sandbox` + `production`). The CLI keeps them isolated so production keys can't run during a test session by accident. Note: each binary talks to one server, so a credential's reachability still depends on which build you installed (see above).

```bash
atoa profile list                  # see every profile + which envs are configured
atoa profile show                  # detailed metadata for the active profile
atoa profile use acme              # switch active profile
atoa profile set env=production    # set the default env for the active profile (prompts)
atoa profile rename acme acme-uk   # rename + re-key keychain slots
atoa profile delete old-merchant   # remove profile + both env slots
atoa whoami --env production       # query a specific env without switching
atoa login --env production        # add a production token to the active profile
```

---

## Sign in

### Browser flow (recommended)

```bash
atoa login --env sandbox      # opens the Atoa dashboard grant page in your default browser
atoa login --env production
```

What happens:

1. The CLI generates a PKCE pair and a random state value, then starts a temporary localhost server on a random port.
2. Your default browser opens the Atoa dashboard grant page (`/auth/extension-callback`).
3. You approve the request in the browser.
4. The dashboard redirects back to `http://127.0.0.1:<port>/callback` with a one-time code.
5. The CLI exchanges the code for a JWT access token + refresh token (server-side PKCE verification).
6. If your account belongs to multiple businesses, you are prompted to pick one (interactive terminals only; non-interactive logins complete and ask you to run `atoa business use <id>` afterwards).
7. A profile is created (or updated) and the JWT pair is stored in the OS keychain.

The browser must be reachable on the same machine as the terminal. For headless or CI environments, use the legacy `--token` flag (see below).

### `--token` / `--stdin` — legacy paste flow (deprecated)

```bash
# Interactive prompt — paste the API key when asked
atoa login --token --env sandbox

# Non-interactive / CI — pipe the key from a secret store
echo "$ATOA_SANDBOX_TOKEN" | atoa login --stdin --env sandbox --profile ci
```

This flow stores only an SDK API key (no JWT session) and is kept for backwards compatibility and headless environments. It will be removed in a future major version. Commands that require a JWT session (see "Which commands need which login" below) are not available in this mode.

### `--provision-key` — mint an SDK key after browser login

```bash
atoa login --env sandbox --provision-key
```

After a successful browser login, creates an SDK API key for `--env` via the JWT session and stores it alongside the JWT tokens. Requires an admin role on the business. The `apiSecret` is shown **once** — save it immediately.

---

## Dual-credential model

The CLI supports two independent credential types per profile and environment:

```
atoa login (browser)
      │
      ├─► JWT access token  ──► account-management commands (v1 API)
      │   JWT refresh token      business, sessions, keys, staff, roles,
      │                          kyb, payment-links, signup, stores get/link-bank
      │
      └─► SDK API key (optional, via --provision-key or atoa keys create)
              ──► payments/data commands (legacy API)
                  payments, refunds, customers, card-on-file,
                  webhooks, bank-feed, payouts, institutions
```

A single `atoa login` always mints a JWT pair. The SDK key is optional and can be added at any time with `--provision-key` or `atoa keys create --save`. Profiles that were paired with the legacy paste flow have an SDK key but no JWT session.

Credentials are stored per-profile, per-environment, in the following keychain slots:

| Slot | Content |
|---|---|
| `<profile>:<env>` | SDK API key (legacy paste flow or `--provision-key`) |
| `<profile>:<env>:jwt-access` | JWT access token (browser login) |
| `<profile>:<env>:jwt-refresh` | JWT refresh token (browser login) |

When the system keychain is unavailable, all three slots fall back to `~/.config/atoa/secrets.json`.

### Which commands need which login

| Auth required | Commands |
|---|---|
| **JWT (browser login)** | `business list/use`, `sessions list/revoke`, `keys create/list`, `kyb status/link`, `staff list/invite`, `roles list`, `payment-links create`, `stores get/link-bank`, `signup` |
| **SDK key** (paste flow or `--provision-key`) | `payments *`, `refunds *`, `customers *`, `payment-methods *`, `card-on-file *`, `webhooks *`, `bank-feed *`, `payouts *`, `stores list`, `institutions list` |
| **Either** | `whoami`, `get`, `post`, `delete`, `keys revoke/regenerate` |

Commands that require JWT will error with a clear message when the active profile was set up with the legacy paste flow. Run `atoa login` (browser) to gain a JWT session, or add `--provision-key` to also mint an SDK key in the same step.

---

## New commands reference

### Account management (`business`, `sessions`)

```bash
atoa business list                      # list businesses on this account; marks the active one
atoa business use <businessId>          # switch the active business for /v1 API calls
atoa sessions list                      # list active CLI/browser sessions for this account
atoa sessions revoke <deviceId>         # revoke a session (--yes to skip confirmation)
```

### SDK key management (`keys create`, `keys list`)

These extend the existing `keys revoke` / `keys regenerate` commands.

```bash
atoa keys create                        # create a new SDK API key (jwt mode; apiSecret shown once)
atoa keys create --save                 # create and store the key as this profile's SDK token
atoa keys list                          # list SDK keys for this account (never shows secrets)
```

### KYB (`kyb`)

```bash
atoa kyb status                         # get the KYB verification status for this business
atoa kyb link                           # print the KYB dashboard deep-link
atoa kyb link --open                    # also open the URL in the default browser
```

### Staff and roles (`staff`, `roles`)

```bash
atoa staff list                         # list staff members for this business
atoa staff invite \
  --firstName Alice --lastName Smith \
  --email alice@example.com \
  --role <roleId>                       # invite a new staff member
atoa staff invite … --store <storeId>   # restrict to one or more stores (repeatable flag)
atoa roles list                         # list available roles for this business
```

### Payment links (`payment-links`)

```bash
atoa payment-links create --amount 1050               # amount in pence (e.g. 1050 = £10.50)
atoa payment-links create --amount 1050 --store <id>  # associate with a store
atoa payment-links create --amount 1050 --notes "Invoice #42"
```

### Stores — new subcommands (`stores get`, `stores link-bank`)

These extend the existing `stores list` command (which uses the legacy SDK key).

```bash
atoa stores get <storeId>               # get a store by ID (jwt mode only)
atoa stores link-bank <storeId> --bank <bankAccountId>  # link a bank account to a store
```

### Merchant onboarding (`signup`)

```bash
atoa signup                             # interactive four-step onboarding wizard (requires jwt login)
atoa signup --from-step 2              # resume from step 2 (businessId must already be set)
atoa signup --skip-extras              # skip step 4 optional extras and finalise immediately
```

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
atoa payments create --amount 25.00 --orderId order-001 --redirectUrl https://shop.example.com/return
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

```bash
# Defaults — fires a PAYMENTS_STATUS event with a generated orderId
atoa webhooks trigger PAYMENTS_STATUS

# Override fields in the dispatched body
atoa webhooks trigger PAYMENTS_STATUS --paymentMethod CARD --status AUTHORIZED
atoa webhooks trigger PAYMENTS_STATUS --orderId order-001 --amount 25.00
atoa webhooks trigger REFUND_STATUS --status FAILED

# POS_PAYMENT_STATUS has multiple body shapes — pick one via --type
atoa webhooks trigger POS_PAYMENT_STATUS --type payment
atoa webhooks trigger POS_PAYMENT_STATUS --type refund --status COMPLETED
atoa webhooks trigger POS_PAYMENT_STATUS --type expired
atoa webhooks trigger POS_PAYMENT_STATUS --type payment \
  --customFields '[{"value":"CUST_001","fieldName":"Customer ID"}]'
```

| Flag | Use |
|---|---|
| `--orderId` | Override the dispatched body's `orderId` |
| `--amount` | Override `paidAmount` in pounds (e.g. 10.05 for £10.05) |
| `--paymentMethod` | `CARD` \| `PAY_BY_BANK` |
| `--status` | `COMPLETED` \| `AUTHORIZED` \| `FAILED` \| `CANCELLED` \| `EXPIRED` (per-event validation server-side) |
| `--type` | `POS_PAYMENT_STATUS` only — selects `payment` / `refund` / `expired` body shape |
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

For endpoints the CLI doesn't yet wrap, or when you want explicit control:

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
| `atoa login` | `--env`, `--profile`, `--token` (deprecated), `--stdin` (deprecated), `--provision-key` |
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
| `ATOA_HOME` | Override the config + secrets location. Defaults to `$HOME`; credentials land in `$ATOA_HOME/.config/atoa/`. Useful for Docker, sandboxed CI, ephemeral containers. |
| `ATOA_PROFILE` | Default profile name. Equivalent to passing `--profile <name>` on every command; the explicit flag still wins. Useful for `export ATOA_PROFILE=ci && atoa …` long-running scripts. |
| `ATOA_BASE_URL` | Unchanged — overrides the Atoa payment API base URL at runtime. |
| `ATOA_DASHBOARD_URL` | Override the dashboard URL used for the browser login grant page (build define default: `https://dashboard.paywithatoa.co.uk`). Set at build time via the `DASHBOARD_URL` tsup define or at runtime via this variable. Useful for self-hosted or staging dashboard deployments. |
| `NODE_TLS_REJECT_UNAUTHORIZED` | Setting this to `0` is **rejected at startup**. The CLI refuses to run with certificate validation disabled. Fix your proxy / CA bundle instead. |

---

## Exit codes

The CLI uses POSIX-style exit codes so shell pipelines and CI systems can branch on the failure mode:

| Code | Meaning | Trigger |
|---:|---|---|
| `0` | Success | Command completed without error |
| `1` | Generic failure | Anything not classified below |
| `2` | Auth / forbidden | HTTP 401 or 403 — token invalid / revoked / lacks permission |
| `3` | Validation error | HTTP 400 / 422, or client-side input rejected (bad amount, bad JSON, bad enum) |
| `4` | Not found | HTTP 404 — resource doesn't exist on this env |
| `5` | Rate limited | HTTP 429 — back off and retry |
| `6` | Network / TLS / DNS | Couldn't reach the server (connection refused, DNS, cert expired, timeout) |

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

```bash
# 1. Pair the runner (token piped from secret store — never on the command line)
echo "$ATOA_SANDBOX_TOKEN" | atoa login --stdin --env sandbox --profile ci

# 2. Make every command target the CI profile, with a stable idempotency key
atoa --profile ci payments create \
  --amount 10.00 --orderId "$RUN_ID" --redirectUrl https://x \
  --idempotencyKey "ci-payment/$RUN_ID" --dryRun

# 3. Read-only checks
atoa --profile ci payments transactions --output json --status COMPLETED

# 4. Clean up (revokes the server-side key too; safe to share across machines)
atoa logout --profile ci --revoke --yes
```

Key patterns:

- **`--stdin`** reads the token from stdin (no shell history, no `ps` exposure).
- **`--profile ci`** scopes every command to a named credential bundle. Same flag form as `ATOA_PROFILE=ci`.
- **`--idempotencyKey "ci-…/$RUN_ID"`** ensures a re-run of the same CI job doesn't create duplicate payments / refunds / charges.
- **`--dryRun`** lets the CI step validate the resolved request body before going live.
- **`--yes`** skips confirmation prompts — required on every destructive command in non-TTY contexts.

---

## Troubleshooting

### `this token belongs to production but you picked sandbox`
The server says your pasted token is a production key; you ran `atoa login --env sandbox`. Re-run with `--env production`, or paste a sandbox token instead.

### `HTTP 401` after pairing a token
The token may have been paired into the wrong env slot (e.g. a production token stored as `sandbox`). Run `atoa whoami --env <env>` to confirm which env the active profile is authenticated against; re-run `atoa login --env <correct-env>` to repair.

### `No profile is configured. Run \`atoa login\` to pair this device.`
First-run state. `atoa login --env sandbox` to pair.

### `Multiple profiles are configured (a, b, c). Run \`atoa profile use <name>\` …`
You have several merchants paired and haven't set a default. Either `atoa profile use <name>` once, or pass `--profile <name>` per command.

### `Timed out acquiring lock on …/secrets.json.lock`
Another `atoa` process is mid-write. If no other process is running (e.g. one crashed), remove the lockfile manually:

```bash
rm ~/.config/atoa/secrets.json.lock
```

### `NODE_TLS_REJECT_UNAUTHORIZED=0 disables certificate validation and is not permitted`
You have an env var disabling TLS verification. Unset it and re-run. If your network needs a custom CA, set `NODE_EXTRA_CA_CERTS=/path/to/ca.pem` instead.

### `Refusing to read …/secrets.json: insecure permissions` (POSIX only)
The secrets file got group/other read bits. Fix:

```bash
chmod 600 ~/.config/atoa/secrets.json
```

### `Refusing to parse …/secrets.json: not valid JSON`
The file got corrupted. Recover with:

```bash
atoa reset --yes && atoa login
```

---

## Documentation

- **Built-in help:** `atoa --help`, `atoa <command> --help`, `atoa <command> <subcommand> --help` — full per-command flag list, always in sync with the binary you have installed.
- **API reference:** see the doc site link from your Atoa Dashboard.

---

## Reset / uninstall

```bash
atoa reset --yes                     # wipe local profiles + tokens (local only)
atoa reset --revoke --yes            # also revoke server-side keys (best-effort)
atoa reset --dryRun                  # preview what would be cleared without touching state
npm uninstall -g @ATOAPaymentsLimited/atoa-cli   # remove the binary
```

---

## Support

`hello@paywithatoa.co.uk` or use chat on the [Dashboard](https://dashboard.paywithatoa.co.uk/).
