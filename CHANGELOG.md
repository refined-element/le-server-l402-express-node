# Changelog

All notable changes to `l402-express` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Versioning policy (0.x)

This package is pre-1.0. Per [semver](https://semver.org/#spec-item-4), 0.x
releases may include breaking changes in **minor** versions: `0.N` → `0.N+1`
can break the public API or change default behavior (called out explicitly in
the entry); patch releases are always backward compatible. Pin a minor range
(e.g. `~0.2.0` or `^0.2.0` — npm's `^` on 0.x already restricts to the same
minor) if you need stability.

## [0.2.0] - 2026-07-03

### Changed (behavior)

- The middleware now sends the request's resource with every `verifyToken`
  call (the same value used at challenge minting: the `resource` option when
  configured, otherwise `req.path`), so the Lightning Enable producer API
  enforces the macaroon's `path` caveat **server-side**. A token minted for a
  different path now verifies as invalid (401) instead of passing. Previously
  no path enforcement happened unless you compared
  `res.locals.l402.resource` yourself.
- `l402-server` dependency bumped to `^0.2.0` (adds `resource`/`amountSats`
  on `VerifyTokenArgs`).

### Added

- `verifyResource` option: set to `false` to disable the enforcement above
  (restoring the 0.1.x behavior), or to a value/function to override the
  resource used for verification independently of the one bound at minting.
- This CHANGELOG.

### Fixed

- README documented the `onInvalidToken` signature as `(req, failure)`;
  the real signature is `(req, res, failure, next)` — the handler is
  responsible for responding on `res` or calling `next`. Following the old
  README, the second argument was actually the Express `Response` and the
  request hung.

## [0.1.0] - 2026-05-12

### Added

- Initial release: `l402()` Express middleware factory — 402 challenge
  issuance with `WWW-Authenticate` header, `Authorization: L402` parsing and
  verification via `l402-server`, `res.locals.l402` credential metadata,
  function-form `priceSats`/`resource`/`description`, `idempotencyKey`
  derivation, `onInvalidToken` hook, 502 mapping for producer-API failures.
