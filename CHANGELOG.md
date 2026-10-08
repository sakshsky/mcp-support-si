# Changelog

All notable changes are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.0] - 2026-10-08

### Added
- Package `@susheelhbti/mcp-support-si`, env prefix `MCP_SI_`.
- `diagnose_setup` and `draft_preview` tools (22 total).
- Optional per-hour send and draft rate limits, serialized by lock files.
- Structured hints on `check_connections` failures.
- Ticket records link to drafts created for them, under the per-ticket lock.
- Example knowledge files under `examples/` (excluded from live scan).
- Additional provider presets: iCloud, Fastmail, GMX, Yandex.
- Optional self-test email in the setup wizard.
- Cross-process concurrency tests using real child processes.
- Fail-closed strict budget scans (`Store.listStrict`) that validate record
  structure and ISO-8601 timestamps via exact round trip.

### Changed
- Send budget, duplicate check, and reservation creation run in one critical
  section under `send-budget.lock`. Duplicate check runs before the budget
  count, so a retry of an existing reservation returns it even when the budget
  is full.
- Ticket updates and draft-linking serialized by a per-ticket lock file.
- Draft integrity: digest recomputed from stored reviewable fields at send time.
- Sender identity bound into the reviewed draft; `Mail.send` uses `draft.from`.
- Knowledge: per-record errors, per-entry traversal errors, underscore-prefix
  exclusion.
- Folder errors: only confirmed missing-mailbox errors are translated.
- Durability: file fsync on reservations; directory fsync is best-effort and
  its failures are ignored.
- Error handling: `AppError` class plus allowlisted library codes.
- Locks are never auto-expired; timeout requires manual recovery.
- `draft_create` returns the draft with a `warning` field if ticket linking
  fails, instead of throwing.
- `draft_list` surfaces skipped-record errors.
- Timestamp validation requires an exact round trip through `Date#toISOString`,
  rejecting impossible dates such as `2026-02-30`.
- Record validation requires a plain object with a string `id` matching the
  filename.
- Recovery guidance consistently retains damaged reservation records in place.

### Fixed
- Draft creation requires a subject when not replying and requires a recipient.
- Invalid dates such as `2026-13-45` and `2026-02-30` are rejected.
- `requireTLS` is only set for STARTTLS mode.
- Packaged sample products removed from `data/products.json`.
- Child-process test imports use `pathToFileURL` for Windows portability.
- Child-process launch errors and timeouts are handled.
- npm setup command uses `npm exec --package=...`.
- CI triggers on candidate branches as well as `main`.

## [2.1.0] - 2026-10-07

### Added
- Initial public structure: IMAP/POP3 read, SMTP send, drafts, tickets, JSON knowledge.

[2.2.0]: https://github.com/susheelhbti/mcp-support-si/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/susheelhbti/mcp-support-si/releases/tag/v2.1.0
