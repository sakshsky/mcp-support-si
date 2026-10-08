# Security Policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's private
vulnerability reporting on the Security tab, or email the maintainer via the
address on the GitHub profile.

Include:
- Affected version
- Reproduction steps
- Impact assessment
- Any suggested fix

We aim to acknowledge within 72 hours and provide a fix or mitigation plan
within 14 days for confirmed issues.

## Scope

In scope:
- Credential exposure
- Injection via headers, MIME, or JSON knowledge files
- Bypass of the send lock, budget, or authorization check
- Path traversal in record IDs or data directories

Out of scope:
- Misconfiguration by the user (wrong host, disabled IMAP)
- Provider-side account restrictions
- Social engineering of the human operator

## Design notes

- Credentials are read from `~/.mcp-support-si/.env` or `MCP_SI_ENV_FILE`.
  The server never logs or returns them.
- All SMTP and IMAP connections require TLS with certificate verification.
- Customer email content is treated as untrusted and flagged as such.
- Sending requires an explicit per-draft authorization flag and a durable lock.
- Raw library errors are never returned to the model; only `AppError` messages
  and an allowlist of library error codes pass through (`safeError` in
  `core.mjs`).
- Repeated SMTP attempts for the same draft are prevented while the reservation
  record remains intact. Damaged reservation records are never deleted to
  unblock sending; they are investigated in place, because removing them
  removes the protection against a duplicate send.
