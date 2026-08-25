# Using the Atoa CLI

This is a real merchant account moving real money. Never guess an id, an amount or a flag. When
unsure, run `atoa <command> --help` — it is authoritative, this file is a summary.

## The one rule that makes everything work

**Pass `--output json` on every command.** It is not only a formatting flag — it is what puts the
CLI into non-interactive mode, so no prompt is ever opened. Add `--yes` to anything that changes or
deletes something.

```
atoa <command> --output json --yes [flags]
```

Never pipe text into stdin, fake a TTY, or use `script`/`winpty`/`expect` to answer a prompt. If a
command insists on being interactive, that is deliberate.

Flags accept either spelling: `--locationName` or `--location-name`.

## How to run a write

1. `atoa <command> --help` — see which flags exist and which are required.
2. **Ask for one value at a time. Wait for the answer, then ask the next.** Do not present a
   numbered list of fields for the user to fill in — that is a form, not a conversation, and it
   makes them do the work of tracking what is still outstanding. If they volunteer several answers
   at once, take them all and carry on from there. Ask about optional values too, offering to skip.
   Never invent a name, address, postcode, sort code, account number, amount or reference.
3. Show the assembled command in full and let them correct it.
4. Run with `--dryRun --output json`, show the resolved request, wait for agreement.
5. Run for real with `--output json --yes`.

If it exits 3, name the flag that was wrong and ask for a corrected value — do not guess and re-run.

## Exit codes — branch on these, not on error text

| Code | Meaning | Action |
|------|---------|--------|
| 0 | success | continue |
| 1 | server error, **or** a malformed invocation | if a `USAGE` block was printed, it's your flags — fix and retry. Otherwise report and stop |
| 2 | not authenticated / not permitted | see Credentials |
| 3 | invalid input the CLI itself rejected (a value that failed validation) | fix what the message names and retry |
| 4 | not found | check the id |
| 5 | rate limited | **stop and wait** — retrying extends the block |
| 6 | network/TLS | report |
| 7 | several businesses, none active | `atoa business list`, ask, then `atoa business use <id>` |
| 8 | plan limit | report; `atoa addons list` shows limits |
| 9 | a one-time code was sent | ask the user for the code, re-run the **same command** plus `--otp <code>` |

Exit 9 is not a failure and not a success: nothing was wrong with your flags, and nothing was
written. It means the CLI sent a code and is waiting for it. `atoa bank add` and `atoa signup` both
report this state the same way.

## Credentials

- **Browser login** (`atoa login`) — `whoami`, `business`, `profile`, `keys`, `sessions`, `stores`,
  `bank`, `kyb`, `staff`, `roles`, `addons`, `comms`, `custom-branding`, `custom-sms`,
  `direct-debit`, `payment-links`, `signup`. Exit 2 → ask the user to run `atoa login`.
- **SDK key** — `payments`, `customers`, `payment-methods`, `card-on-file`, `refunds`, `payouts`,
  `webhooks`, `bank-feed`, `institutions`, and raw `get`/`post`/`delete`. Exit 2 → check
  `atoa keys list --output json`, or mint one with `atoa keys create` (see **API keys** below for
  the name rule and `--env`).

`--profile <name>` selects a stored account. If more than one exists, ask which before writing.

Start every session with `atoa whoami --output json` and say whose account you are acting on.

---

## Reading (safe — run these without asking)

```
atoa whoami                      atoa business list
atoa profile list                atoa profile show
atoa stores list                 atoa stores get <id>
atoa bank list                   atoa bank get <id>
atoa staff list                  atoa roles list
atoa addons list                 atoa comms list
atoa kyb status                  atoa kyb card status
atoa custom-branding get         atoa custom-sms list
atoa direct-debit status         atoa sessions list
atoa keys list                   atoa institutions list
atoa webhooks list               atoa payouts list
atoa payments transactions       atoa customers list
atoa customers get <id>          atoa payments status <id>
atoa payouts transactions <id>   atoa bank-feed accounts <accountAuthId>
atoa bank-feed account <id>      atoa bank-feed balance <id>
atoa payment-methods get <id> --customer <customerId>
atoa bank-feed transactions <id> --from <ISO> --before <ISO>
atoa refunds list --paymentRequestId <id>
```

`payments status` also takes `--poll`, which loops every 5 seconds for up to **3 minutes** waiting
for a non-PENDING status, printing nothing until it resolves or times out. Don't use it — run the
plain command again when you want a fresh reading.

## Getting a link to give the user

`kyb link` and `kyb card link` open a browser at a dashboard page. You have no browser, so add
`--dryRun` — it prints the URL and opens nothing:

```
atoa kyb link --dryRun --output json
#   → {"url": "https://…/verification?merchantId=…"}
atoa kyb card link --dryRun --output json
#   → {"url": "https://…/card-signup?merchantId=…"}
```

Show the user the URL and ask them to open it. Without `--dryRun` the command tries to launch a
browser on the machine the CLI is running on, which is not where the user is looking.

**Which one:** for a merchant who hasn't been verified yet, use **`kyb link`** — card activation is
part of that same wizard. **`kyb card link`** is only for a merchant who is *already* KYB-verified
and wants to add card payments afterwards.

**Check the status before handing over a card link.** `--dryRun` prints the URL without contacting
the API, which means it also skips the precondition the browser path enforces. `/card-signup`
silently redirects a merchant who hasn't submitted KYB to `/home`, so the link looks broken to them
while your command exited 0. Run `atoa kyb status --output json` first and only pass the card link
on once KYB has been submitted and not rejected.

Both commands need an active business. Without one they exit **3** (not 7, despite the table) —
fix it with `atoa business use <id>`; you do not need `atoa login` unless the profile has no
session at all.

Verification itself happens in the browser — no CLI command completes it. Poll
`atoa kyb status --output json` afterwards to see whether it went through.

---

## Creating, updating, deleting

Values shown in **bold** are the ones you must collect from the user. `<ID>` is a positional
argument. Run `atoa <command> --help` for the authoritative required/optional split.

### Stores
| Action | Command | Ask the user for |
|---|---|---|
| create | `stores add` | **location name**, **address line 1**, **town/city**, **postcode**; optionally address line 2 |
| update | `stores update <ID>` | which store, then any of the same fields |
| link bank | `stores link-bank <ID> --bank <bankId>` | which store, which bank account |

Flags: `--locationName --addressLine1 --addressLine2 --cityOrTown --addressPostalCode`
Only `--addressLine2` is optional. Location name: 3–30 characters, letters, numbers and spaces.

A store cannot be added until a bank account exists — **including** the rename case below. "Default"
is not a valid location name, but if the business still has only its original DEFAULT location,
`stores add` **renames it in place** rather than creating a second one. Only the plan limit is
skipped on that path; the bank-account requirement still applies.

### Bank accounts
| Action | Command | Ask the user for |
|---|---|---|
| create | `bank add` | **bank name**, **sort code**, **account number**; also ask for the account holder name (see below); optionally nickname, currency, primary |
| delete | `bank delete <ID> --yes` | which account |

Flags: `--bankName --sortCode --accountNumber --accountHolderName --nickName --currency --setPrimary --otp`
Required: `--bankName`, `--sortCode`, `--accountNumber`. Sort code is exactly **6 digits** and
tolerates spaces and hyphens (`12-34-56`, `12 34 56`). Account number is exactly **8 digits** and
tolerates **spaces only** — `1234-5678` is rejected.

`--accountHolderName` is technically optional, but **ask for it and pass it**: it is what the
Confirmation-of-Payee check runs against, and omitting it gives up that check. It is not
length-limited here. `--nickName`, `--currency` and `--setPrimary` are optional.

**Adding a second account requires a one-time code.** Run it without `--otp` first; it exits **9**
with *"An OTP was sent to your registered contact. Re-run with --otp &lt;code&gt;"*. Ask the user for the
code, then re-run the **same command** plus `--otp <code>`. The first account on a business is not
challenged. One attempt per code — a wrong one is not retried; go back to the user for a fresh one.

**Never loop on this.** Requesting codes repeatedly, or submitting wrong ones repeatedly, trips a
throttle: roughly one send per minute, and too many wrong codes blocks the account for an **hour**
that a new code cannot clear. If you see exit 5, stop entirely and tell the user to wait — do not
re-request. Two failed attempts is the point to hand back, not to try again.

### Staff
| Action | Command | Ask the user for |
|---|---|---|
| create | `staff add` / `staff invite` | **first name**, **last name**, **role**, and **either an email or a phone number** |
| update | `staff update <ID>` | which user, then the fields to change |
| delete | `staff delete <ID> --yes` | which user |

Flags: `--firstName --lastName --email --phoneCountryCode --phone --role --store`
`--role` is **required** — run `atoa roles list --output json` first and ask which role. A contact
is required too, but either channel satisfies it: `--email`, or `--phoneCountryCode` **and**
`--phone` together. `--store` is optional.

### Roles
| Action | Command | Ask the user for |
|---|---|---|
| create | `roles add` | **role name**; optionally description and permissions |
| update | `roles update <ID>` | which role, then name/description/permissions |
| delete | `roles delete <ID> --yes` | which role |

Flags: `--name --description --permission`
Only `--name` is required: 3–100 characters, and it must not duplicate an existing role name
(the check is case-insensitive). `--description` and `--permission` are optional.

### Add-on plan
| Action | Command | Notes |
|---|---|---|
| upgrade | `addons upgrade <planId> --yes` | **changes billing** — always confirm the plan and price with the user first |
| downgrade | `addons downgrade <planId> --yes` | refused if current usage exceeds the target plan |
| cancel | `addons cancel-downgrade --yes` | |

Run `atoa addons list --output json` first to get plan ids and prices. Upgrades require the business
to be KYB-verified.

### Notification preferences
`atoa comms set <topic> --email on|off --sms on|off --push on|off`

Run `atoa comms list` first for valid topics. At least one channel flag is required.

### Branding & SMS name
```
atoa custom-branding set "#RRGGBB"      atoa custom-branding reset --yes
atoa custom-sms set <NAME>              atoa custom-sms delete --yes
```
Theme colour: a **6-digit hex** value, e.g. `#FF0000`. SMS sender name: **3–11 characters**,
letters, numbers and spaces — `Acme Ltd` is fine; `Acme-Ltd` and `AB` are not.

### Direct Debit (platform fees)
`atoa direct-debit setup` — ask for **account number**, **sort code**, **name**, **email**,
**address line 1**, **city**, **postcode**. Only `--addressLine2` is optional. Sort code and account
number share `bank add`'s validators exactly (6 and 8 digits, same separator handling). Unlike
`bank add`, the **name here is required and capped at 20 characters** — it is what the mandate's
name field accepts. One mandate per business; it cannot be set up twice, so check
`atoa direct-debit status --output json` before offering to create one.

### API keys
```
atoa keys create --name "CI server" [--env sandbox|production]
atoa keys revoke <ID> --yes
atoa keys regenerate <ID> --yes
```

Key names take letters, numbers and spaces. Hyphens and underscores are rejected — `ci-server`
fails, `CI server` works. (The API's own message says "letters and numbers"; spaces are fine.)

`--env` decides which environment the key is for. `customers` and `card-on-file` need a
**production** key and will refuse a sandbox one, so mint with `--env production` for those.

### Payments & payment links (SDK key)
| Action | Command | Required |
|---|---|---|
| create payment | `payments create` | **--amount**, **--orderId** |
| cancel payment | `payments cancel <ID> --yes` | |
| create link | `payment-links create` | **--amount**, **--storeId** |
| get link | `payment-links get <ID> --storeId <id>` | **--storeId** |
| delete link | `payment-links delete <ID> --storeId <id> --yes` | **--storeId** |

`payment-links get`/`delete` need `--storeId` **as well as** the id — the id alone is not enough.

### Customers & saved cards (SDK key)
| Action | Command | Required |
|---|---|---|
| create | `customers create` | **--fullName**, plus `--email` or `--phoneNumber` |
| update | `customers update <ID>` | any of the create fields |
| delete | `customers delete <ID> --yes` | |
| list cards | `payment-methods list --customer <id>` | **--customer** |
| delete card | `payment-methods delete <ID> --customer <id> --yes` | **--customer** |
| charge card | `card-on-file charge` | **--customerId --paymentMethodId --amount --orderId** |

`customers` and `card-on-file` are **production-pinned** — they need a production key
(`atoa keys create --env production`), not a sandbox one.

Charging a saved card moves money. Always `--dryRun` first and get explicit confirmation of the
amount and the customer.

### Refunds & webhooks (SDK key)
```
atoa refunds create --paymentRequestId <id> --amount <n>
atoa refunds cancel <ID> --yes
atoa webhooks create --url <url> --event <event>     # exits 3 listing valid events if wrong
atoa webhooks delete <ID> --yes
```

### Raw API
```
atoa get <path> [-d key=value]
atoa post <path> --data '<json>'
atoa delete <path> --yes
```
Uses the SDK key. `--dryRun` first on `post`/`delete`.

---

## Signing up a new account

Two invocations — the code goes to the user's email and you cannot read it.

**Collect everything BEFORE you send the code.** The code expires about 10 minutes after it is
sent, so asking a dozen questions between the two commands can burn the whole window and force a
resend. Work in this order:

1. **Collect every value first, asking one question at a time** — email, business name, industry,
   monthly turnover, business structure, VAT number, first name, last name, postcode, address
   line 1, in that order. Wait for each answer before asking the next; do not paste the list and
   ask them to fill it in. Then offer the optional ones together, as one question they can decline:
   website URL, address line 2, phone number.
2. Confirm they accept the Privacy Policy and Terms of Service (see below).
3. Show them the full command you are about to run.
4. **Only then** run the first invocation, which sends the code:
   ```
   atoa signup --email <email> --output json
   # → "An OTP has been sent to <email>."   exit 9
   ```
5. Ask them for the code and immediately run the second invocation with everything:
   ```
   atoa signup --email <email> --otp <code> --accept-terms \
     --business-name "..." --industry "..." --monthly-turnover "..." \
     --business-structure "Limited Company" --vat-number 123456789 \
     --first-name "..." --last-name "..." \
     --postal-code "..." --address-line1 "..." --output json
   ```

**If the second invocation fails after printing `✓ Account created`, do NOT ask for another code.** The account
exists and you are signed in; the code has done its job. Fix whatever the error names and re-run the
same command **without `--otp`** — it resumes from where it stopped.

- **`--accept-terms` records their acceptance of the Privacy Policy and Terms of Service.** Only
  pass it if they have explicitly agreed, and tell them what they are agreeing to. `--marketing` is
  a separate opt-in, off unless asked for.
- `--business-structure` is **Limited Company** or **Charity** — offer those two as a choice.
- `--industry` and `--monthly-turnover` come from the API, so you cannot know the valid values in
  advance. Ask in plain language, then expect to refine: if the value doesn't match, the CLI exits 3
  and **lists every valid option**. Show that list, ask which one they meant, and re-run **without
  `--otp`** (the account already exists by then). Tell the user to expect this rather than treating
  it as an error. Never guess — "Retail" is ambiguous when nine options begin with it.
- **`--vat-number` is required**, and must be 9 digits, optionally prefixed `GB`. Spaces are fine
  (`GB 123 456 789` works). There is no "none" — do not offer one. If the business genuinely has no
  VAT number, signup cannot be completed from the CLI.
- **Genuinely optional**, and fine to skip — offer them together as one question they can decline:
  `--website-url`, `--address-line2`, `--phone-country-code`, `--phone-number`.
- **The same OTP throttle applies here.** One attempt per code; if it's wrong, ask the user for a
  new one *once*. Do not sit in a request-a-code loop — repeated sends are rate-limited per minute
  and repeated wrong codes block the account for an hour. Exit 5 means stop and wait.
- Re-running on a finished business reports "Nothing to do" and creates nothing. Pass
  `--start-new` to deliberately create a second business.
- `--from-step 2|3` resumes a partially-completed onboarding.

## Hand this one back

The test is not "does it destroy something" — you run deletes all the time, following the workflow
above. The test is **does the damage escape this conversation**: another machine, CI, the merchant's
live systems, real money, or a session only the user can restore. Those you do not run, whatever
flags are available.

Show the user the exact command, ask them to run it, and continue from what they report.

- **`atoa login`** — opens a browser and cannot be scripted.
- **`atoa reset`** — deletes every profile and stored token, **both environments**, not just the
  active one. `--revoke` additionally revokes SDK keys server-side, including production, which
  cannot be undone and breaks CI or anyone else holding that key. `atoa reset --dryRun` is safe and
  prints exactly what would be cleared — show them that, then let them decide. It has **no
  `--output` flag**, so without `--yes` it opens a prompt you cannot answer.
- **`atoa logout`** — revokes the refresh token and ends the session. Only `atoa login` restores it,
  and you cannot run that, so this strands you. Its `--revoke` flag is a no-op kept for script
  compatibility and is **not** the same as `reset --revoke`, which revokes SDK keys server-side;
  `--purge-key` deletes the profile's stored SDK keys locally only.
- **`atoa sessions revoke`** — may revoke the session this CLI is using, with the same consequence.
  It also checks `--yes` *before* `--dryRun`, so you cannot preview it: `sessions revoke <id>
  --dryRun` fails asking for `--yes`.
- **`atoa card-on-file capture`** — takes the money. A capture is the payment, not a rehearsal.
- **`atoa webhooks trigger`** — sends a real webhook to the merchant's live callback URL, with
  `--orderId`, `--amount` and `--status` all overridable. Their system treats whatever you dispatch
  as a genuine event.
- **`atoa bank-feed revoke`** — ends a bank consent. Re-establishing it needs the merchant at their
  bank; there is no CLI command that undoes it.

That list is closed. **Everything else that changes or deletes** — including `bank delete`,
`roles delete`, `staff delete`, `payment-links delete`, `customers delete`, `keys revoke` — follows
"How to run a write": propose it, `--dryRun` it, get agreement, then run it with `--yes`. Do not
hand those back.
