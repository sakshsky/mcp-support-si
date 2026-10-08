# Contributing

Thanks for helping improve MCP Support SI.

## Setup

1. Node.js 22 or newer.
2. `npm ci --ignore-scripts`
3. `npm test` — all tests must pass before you open a PR.

## Pull requests

- Keep changes focused. One logical change per PR.
- Add or update tests for behavior changes.
- Do not include real credentials, customer data, or `.env` files.
- Update `CHANGELOG.md` under an `Unreleased` heading.
- Run `npm test` locally.

## Reporting bugs

Use the bug report template. Include Node version, OS, provider, and the exact
tool call that failed. Never paste real credentials or customer email content.

## Code style

- ES modules, Node 22 syntax.
- Two-space indent, single quotes, semicolons.
- No new runtime dependencies without discussion in an issue first.
