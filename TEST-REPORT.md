# Test Report — v2.2.0

Every result starts as **Not run**. Fill in only after running the corresponding
check. Do not pre-fill any result. Record the candidate commit SHA produced by
`git rev-parse HEAD` before running the tests.

Candidate commit SHA: `<fill in after candidate commit>`

| Check | Command | Result | Notes |
| --- | --- | --- | --- |
| Unit + integration tests (Node 22) | `nvm use 22 && node --version && npm test` | Not run | |
| Unit + integration tests (Node 24) | `nvm use 24 && node --version && npm test` | Not run | |
| Cross-process concurrency tests | included in `npm test` | Not run | |
| Impossible-date rejection (`2026-02-30`) | included in `npm test` | Not run | |
| Fail-closed budget: corrupt record | included in `npm test` | Not run | |
| Fail-closed budget: impossible timestamp | included in `npm test` | Not run | |
| Fail-closed budget: non-ISO timestamp | included in `npm test` | Not run | |
| Fail-closed budget: id mismatch | included in `npm test` | Not run | |
| Ticket-link warning (redacted) | included in `npm test` | Not run | |
| Lenient listing structural skip | included in `npm test` | Not run | |
| CI matrix (Ubuntu/Windows/macOS) | GitHub Actions, branch `candidate-*` or PR to `main` | Not run | |
| Pack inspection | `npm pack --dry-run` | Not run | |
| Clean install from tarball | `npm install <tarball>` then MCP smoke test | Not run | |
| MCP smoke test | Claude Desktop / Codex | Not run | |
| Dependency audit | `npm audit --omit=dev` | Not run | |
| Provider auth: Gmail | test account | Not run | |
| Provider auth: Zoho | test account | Not run | |
| Provider auth: Outlook | test account | Not run | |

## Known limitations

- Packaged `data/*.json` files are empty by design.
- Real-provider authentication is untested until dedicated test accounts exist.
- Directory submission to any plugin marketplace is not prepared.
