# MCP Support SI

[![CI](https://github.com/susheelhbti/mcp-support-si/actions/workflows/ci.yml/badge.svg)](https://github.com/susheelhbti/mcp-support-si/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node >=22](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)

Local Model Context Protocol server for customer support email. Node.js 22+ required.
The host assistant writes the replies; this server provides mailbox access, business
knowledge, and case records. No separate AI API key is needed.

## Install

```sh
npx @susheelhbti/mcp-support-si
```

Or register with Codex directly:

```sh
codex mcp add mcp-support-si -- npx -y @susheelhbti/mcp-support-si
```

### Setup path depends on how you installed

**From npm** (published package): the package includes the runtime files but not
`package-lock.json` or the test suite. Run the wizard directly:

```sh
npm exec --package=@susheelhbti/mcp-support-si -- mcp-support-si-setup
```

The wizard writes `~/.mcp-support-si/.env`. You do not need `npm ci` for this path.

**From source** (git clone):

```sh
git clone https://github.com/susheelhbti/mcp-support-si.git
cd mcp-support-si
npm ci --ignore-scripts
npm run setup
```

This path is for development and for verifying the tests.

**Registering with an MCP host:** either path works. For the npm path:

```sh
codex mcp add mcp-support-si -- npx -y @susheelhbti/mcp-support-si
```

For the source path:

```sh
codex mcp add mcp-support-si -- node /full/path/to/mcp-support-si/server.mjs
```

## Safety model

- **Repeated SMTP attempts prevented.** The plugin prevents repeated SMTP
  attempts for the same draft while its reservation record remains intact. A
  durable reservation is written before SMTP contact; concurrent or later calls
  for the same draft return the existing record. Do not delete a reservation
  record to work around a stuck send; investigate it in place.
- **No raw error leakage.** Only `AppError` messages constructed by this plugin
  and an allowlist of library codes reach the model. Credentials never appear
  in output.
- **Untrusted content flag.** Every message body and attachment name is marked
  as untrusted customer data so the agent treats it accordingly.
- **Immutable drafts.** Drafts cannot be edited in place; revisions create a
  new version with a new hash. The send tool requires the exact reviewed version.
- **Mailbox integrity checks.** UIDVALIDITY is verified before every UID operation.
- **Optional rate limits.** Set `MCP_SI_MAX_SENDS_PER_HOUR` or
  `MCP_SI_MAX_DRAFTS_PER_HOUR` to cap outbound volume.

### Authorization is a caller assertion

The `authorized: true` argument to `draft_send` is a declaration by the calling
agent that the human user has approved *that specific draft* — the recipient,
subject, and full body. The MCP server cannot verify this. Hosts and agents must
obtain explicit human approval before calling `draft_send`. Enabling
`MCP_SI_ENABLE_SEND=true` grants the *capability* to send; it does not constitute
approval for any particular message.

## Setup

You need Node.js 22+ and an account whose provider permits IMAP or POP3 plus SMTP.
Each user connects their own account; the package includes no credentials.

The wizard supplies provider defaults, asks you to confirm the servers, accepts
a hidden local app password or token, and asks for your JSON folder. It saves
settings without manual file editing. Credentials never need to enter chat. You
can leave the secret blank to finish authentication later. Running setup again
replaces the mail settings, preserves other environment keys, and disables sending.

Restart your MCP host after saving, then ask **"Check my email connection."**
The optional wizard login check and the `check_connections` tool send no email.

### Provider defaults

| Provider | IMAP TLS (993) | SMTP | Notes |
| --- | --- | --- | --- |
| Gmail | imap.gmail.com | smtp.gmail.com:465 TLS | App passwords need 2-Step Verification; may be restricted by admin policy |
| Outlook.com | outlook.office365.com | smtp-mail.outlook.com:587 STARTTLS | Requires OAuth2; no built-in OAuth sign-in |
| Microsoft 365 | outlook.office365.com | smtp.office365.com:587 STARTTLS | OAuth and tenant/mailbox permissions required |
| Zoho personal | imap.zoho.com | smtp.zoho.com:465 TLS | Verify region and plan |
| Zoho business | imappro.zoho.com | smtppro.zoho.com:465 TLS | Regional hosts can differ |
| Yahoo | imap.mail.yahoo.com | smtp.mail.yahoo.com:465 TLS | Provider-generated app password |
| iCloud | imap.mail.me.com | smtp.mail.me.com:587 STARTTLS | App-specific password required |
| Fastmail | imap.fastmail.com | smtp.fastmail.com:465 TLS | App password recommended |
| GMX | imap.gmx.com | mail.gmx.com:587 STARTTLS | Enable IMAP in account settings |
| Yandex | imap.yandex.com | smtp.yandex.com:465 TLS | App password required |
| Custom | Ask your mail host | Ask your mail host | A custom domain does not identify the provider |

These are starting defaults, not proof of account eligibility. Confirm them for
your actual account. Microsoft OAuth token acquisition and refresh remain
external; selecting a preset does not complete Microsoft authentication. POP3
supports password authentication only.

## JSON knowledge folder

The server reloads JSON on each knowledge search, including subfolders. Symlinks
are skipped; files are limited to 1 MB. Folders and files whose names begin with
`_` are skipped, so `_examples` and `_private` content is never treated as live
knowledge.

Only records explicitly marked `active: true` are approved. A record needs its
own `updated` date (format `YYYY-MM-DD`) or a date inherited from its enclosing
document. Example:

```json
{
  "updated": "2026-10-07",
  "policies": [
    { "id": "returns", "active": true, "text": "30-day returns on unopened items." }
  ]
}
```

See `examples/` for working samples. Malformed files are reported per record;
they are never silently treated as valid.

## Environment variables

All settings use the `MCP_SI_` prefix. See `.env.example` for the full list.

| Variable | Purpose |
| --- | --- |
| `MCP_SI_ENV_FILE` | Absolute path to a `.env` file (overrides default) |
| `MCP_SI_MAIL_USER` | Mailbox username |
| `MCP_SI_MAIL_PASSWORD` | App password |
| `MCP_SI_ACCESS_TOKEN` | OAuth access token (IMAP/SMTP) |
| `MCP_SI_FROM` | From address (defaults to user) |
| `MCP_SI_IMAP_HOST` / `MCP_SI_IMAP_PORT` | IMAP server |
| `MCP_SI_SMTP_HOST` / `MCP_SI_SMTP_PORT` / `MCP_SI_SMTP_SECURITY` | SMTP server and mode |
| `MCP_SI_POP3_HOST` / `MCP_SI_POP3_PORT` | POP3 server |
| `MCP_SI_DATA_DIR` | Absolute JSON knowledge folder |
| `MCP_SI_STATE_DIR` | Absolute state folder |
| `MCP_SI_ENABLE_SEND` | `true` to enable sending (off by default) |
| `MCP_SI_MAX_SENDS_PER_HOUR` | Send rate cap (0 = unlimited) |
| `MCP_SI_MAX_DRAFTS_PER_HOUR` | Draft rate cap (0 = unlimited) |

## Included operations

- IMAP: folder listing/creation, paginated inbox/body search, read without
  marking Seen, Seen/Flagged/Answered flags, atomic moves to folders including
  Trash.
- POP3: paginated UIDL list and read; leaves mail on the server.
- SMTP: send an exact local draft with proper reply threading and stable Message-ID.
- Local drafts: create, list, inspect, preview; revise by creating another
  immutable draft.
- Complaints: create, list/filter, inspect, add notes, set priority and status.
- Knowledge: fresh recursive search of approved JSON records, with source and date.
- Status: configuration checks, authentication checks, persistent send outcomes.
- Diagnostics: `diagnose_setup` self-check (no secrets), `connection_status`.

## Delivery and limits

### SMTP acceptance vs. delivery

SMTP acceptance is not delivery confirmation. A Sent-folder copy is not written
by this plugin; absence from the Sent folder does not prove failure, and presence
does not prove the recipient received the message.

### Recovery after uncertain delivery

If `send_status` returns `sending` or `delivery_unknown`, the plugin will not
retry automatically. To resolve an uncertain send:

1. Contact the recipient out-of-band (phone, chat, alternate email) to confirm
   whether the message arrived.
2. Check the provider's webmail Sent folder as one signal among others, not as
   proof. Many providers do not append IMAP-sent mail to Sent, and some append
   with a delay.
3. If the recipient confirms receipt, no further action is needed.
4. If the recipient confirms non-receipt and you decide to send again, create a
   **new** draft. Keep the original reservation record (`stateDir/sends/<id>.json`)
   in place as audit history. Do not delete it: the reservation is what prevents
   the original draft from being sent again, and removing it may permit a
   duplicate if the original message is merely delayed.

### Durability

Send reservations are written with a file-level `fsync` before SMTP contact. On
POSIX systems, the plugin also attempts a directory `fsync` after the write.
That directory fsync is **best-effort**: it is skipped if the filesystem does
not support it, and any error is ignored. Where it succeeds it reduces the
window in which a crash could leave the reservation's directory entry unsynced;
where it does not, the file's content is still on disk but the directory entry's
durability is left to the OS.

If a crash occurs after SMTP accepts but before the success record is written,
the send remains in `sending` state, which blocks automatic retry. The operator
must determine the outcome out-of-band before any new attempt.

### Cross-process locks

Locks in `stateDir/locks/` are never auto-expired. If a process crashes while
holding a lock, subsequent operations fail with `Lock timeout at <path>`. To
recover: confirm the owning process has stopped, delete the named lock file,
and retry.

### Concurrency model

- **Send budget.** The duplicate check, budget count, and reservation creation
  all run inside a single critical section guarded by
  `stateDir/locks/send-budget.lock`. Concurrent processes sharing a state folder
  cannot exceed `MCP_SI_MAX_SENDS_PER_HOUR`, and a retry of an existing
  reservation returns that reservation even when the budget is full.
- **Draft budget.** Similarly serialized by `stateDir/locks/drafts-budget.lock`.
- **Fail-closed scans.** Budget scans read every reservation record strictly.
  Records must be JSON objects with a matching `id` field and a valid ISO-8601
  UTC timestamp (exact round trip through `Date`). If any record fails these
  checks, the operation fails with `Cannot scan <kind>` or `failed validation`
  rather than undercounting. **Do not delete a damaged record to unblock
  sending**; investigate it in place. Removing it removes its duplicate-send
  protection and could permit a duplicate.
- **Ticket updates.** `ticket_update` and the ticket-linking step of
  `draft_create` both run under `stateDir/locks/ticket-<id>.lock`. Concurrent
  updates serialize; a caller whose `expectedUpdated` no longer matches is
  rejected with `Ticket changed; reload it first`.
- **Single state folder per team.** Run one state folder per team. Multi-host
  editing of the same state folder over a network filesystem (NFS/SMB) is not
  supported.

### Message limits

Messages over 10 MB are rejected; body text is capped at 60,000 characters.
Attachment metadata is shown; file download, attachment sending, permanent
deletion, POP3 deletion, refund/order APIs, automatic monitoring, and unattended
replies are not implemented. Ticket statuses are internal records, not actions
in a commerce system.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `envFilePresent: false` in `diagnose_setup` | Setup not run | Run the setup wizard in your own terminal |
| `check_connections` returns `EAUTH` hint | Wrong app password or protocol disabled | Regenerate the app password; enable IMAP/SMTP in your provider settings |
| `check_connections` returns `ENOTFOUND` hint | Wrong hostname | Verify the server address with your provider |
| `check_connections` returns `ESOCKET` hint | TLS mode mismatch | Confirm `MCP_SI_SMTP_SECURITY` matches the port |
| `Folder not found: X` | Folder name is wrong | Call `mail_folders` to list exact names |
| `Sending disabled` | Sending not enabled | Set `MCP_SI_ENABLE_SEND=true` and restart the host |
| `Draft content changed since review` | Draft edited on disk | Create a new draft and re-approve |
| `Ticket changed; reload it first` | Concurrent update | Re-read the ticket and retry |
| `Lock timeout at ...` | Stale lock from a crashed process | Confirm the owning process stopped; delete the named lock file |
| `Cannot scan sends` / `Cannot scan drafts` / `failed validation` | A reservation or draft record is unreadable, malformed, or structurally invalid | Investigate the reported file in `stateDir/<kind>/` **in place**. Do not delete it: the record is protecting against duplicate sends. Back it up if you need to inspect it elsewhere |
| `Draft saved, but ticket link failed` warning | Ticket file was moved or corrupted between draft creation and linking | The draft exists and can be sent; update the ticket manually |

## Development

```sh
npm ci --ignore-scripts
npm test
```

Tests use temporary directories and fake mail services; they send no customer
email. Run connection checks against your provider after supplying credentials
in a dedicated test account.

## License

MIT — see [LICENSE](./LICENSE).
