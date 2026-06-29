# Changelog

All notable changes to the Atoa CLI are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
