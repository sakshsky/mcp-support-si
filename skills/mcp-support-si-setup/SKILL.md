---
name: mcp-support-si-setup
description: Guide a user through MCP Support SI setup, provider selection, local credential entry, and connection checks. Use when the user says set up my email, configure MCP Support SI, or connection_status reports missing settings.
---

# Set up MCP Support SI

1. Ask for the email provider and address if not already supplied. These are not
   passwords. Explain that each installer uses their own mailbox and JSON folder.
2. Call `connection_status` and, if troubleshooting, `diagnose_setup`. Never read
   or display an existing `.env` file or request secrets through chat, tool
   arguments, a shared terminal, or screenshots.
3. Guide the user to run the setup wizard in their own terminal:

   - **From source (git clone):** `npm ci --ignore-scripts` then `npm run setup`
     in the plugin directory.
   - **From npm:** `npm exec --package=@susheelhbti/mcp-support-si -- mcp-support-si-setup`

   The wizard asks for provider, email, server confirmation, a hidden local app
   password or token, and JSON folder, then writes the local `.env`. Do not run
   its credential prompts through agent terminal tools or capture output from
   the user's terminal. The user owns the secret-entry step.
4. Use the provider table in the README as defaults, not proof of account
   eligibility. The wizard lets the user confirm or change hosts. Custom domains
   may use any provider.
5. Be explicit: the plugin accepts externally obtained IMAP/SMTP OAuth access
   tokens but has no interactive OAuth sign-in or token refresh. Do not claim
   Microsoft setup is complete until authentication succeeds. POP3 supports
   password authentication only. Provider access can depend on plan or admin
   settings.
6. The wizard saves to `~/.mcp-support-si/.env`, or `MCP_SI_ENV_FILE` if
   explicitly configured. Secrets stay outside the package. It preserves
   non-mail settings and disables sending. Ask the user to restart the host
   after saving.
7. Call `check_connections` for the selected incoming protocol and SMTP; these
   send no email. Read only the inbox scope the user requests. Help resolve
   missing JSON data, authentication, or host errors without requesting
   credentials in chat.
8. Keep sending disabled unless explicitly requested by the human. Explain that
   enabling the capability still requires per-message send authorization.

Never commit `.env` or state records. Do not publish the plugin or choose a
license on the owner's behalf during mailbox setup. The local stdio server
requires a host capable of running Node.js; a ZIP does not make it a hosted
web service.
