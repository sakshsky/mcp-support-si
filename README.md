# MCP Support SI — Full Release Package

Package: `@susheelhbti/mcp-support-si` · Version: `2.2.0` · Author: Susheel HBTI

Everything below is final, drop-in ready. Replace the corresponding files in your repo, run the tests, then publish.

---

## 📋 Step-by-Step: What To Do

### Step 1 — Rename your project folder (optional but recommended)
```sh
# If your local folder is still "noxr-email-assistant", rename it:
mv noxr-email-assistant mcp-support-si
```

### Step 2 — Replace these files
| File | Action |
|---|---|
| `.env - Copy.example` | **Delete** and create `.env.example` |
| `package.json` | **Replace** with §1 below |
| `core.mjs` | **Replace** with §2 |
| `server.mjs` | **Replace** with §3 |
| `setup.mjs` | **Replace** with §4 |
| `plugin.json` | **Replace** with §5 |
| `.codex-plugin/plugin.json` | **Replace** with §6 |
| `mcp.json` | **Replace** with §7 |
| `README.md` | **Replace** with §8 |
| `test/mcp.test.mjs` | **Update** tool count 20 → 22 (see §12) |
| `test/support.test.mjs` | **Add** two new tests (see §12) |

### Step 3 — Add these new files
| File | Section |
|---|---|
| `LICENSE` | §9 |
| `CHANGELOG.md` | §10 |
| `SECURITY.md` | §11 |
| `CONTRIBUTING.md` | §13 |
| `CODE_OF_CONDUCT.md` | §14 |
| `.github/workflows/ci.yml` | §15 |
| `.github/ISSUE_TEMPLATE/bug_report.md` | §16 |
| `.github/ISSUE_TEMPLATE/feature_request.md` | §17 |
| `skills/mcp-support-si-reply/data/_examples/policies.example.json` | §18 |
| `skills/mcp-support-si-reply/data/_examples/faq.example.json` | §18 |

### Step 4 — Run everything
```sh
npm ci --ignore-scripts
npm test
```

### Step 5 — Publish
```sh
git add -A
git commit -m "Release 2.2.0: MCP Support SI, open-source readiness, safety hardening"
git tag v2.2.0
git push origin main --tags
npm publish --access public
```

### Step 6 — Users install
```sh
npx @susheelhbti/mcp-support-si
# or register directly:
codex mcp add mcp-support-si -- npx -y @susheelhbti/mcp-support-si
```

---

## 1. `package.json`

```json
{
  "name": "@susheelhbti/mcp-support-si",
  "version": "2.2.0",
  "description": "MCP Support SI (Super Intelligent) — local Model Context Protocol server for customer support email: IMAP/POP3 inbox, SMTP replies, complaint tracking, approved JSON knowledge.",
  "author": "Susheel HBTI <susheelhbti@users.noreply.github.com>",
  "license": "MIT",
  "type": "module",
  "private": false,
  "engines": { "node": ">=22" },
  "keywords": [
    "mcp",
    "model-context-protocol",
    "super-intelligent",
    "email",
    "imap",
    "smtp",
    "pop3",
    "customer-support",
    "ai-agent"
  ],
  "repository": { "type": "git", "url": "https://github.com/susheelhbti/mcp-support-si.git" },
  "homepage": "https://github.com/susheelhbti/mcp-support-si#readme",
  "bugs": { "url": "https://github.com/susheelhbti/mcp-support-si/issues" },
  "bin": { "mcp-support-si": "server.mjs" },
  "files": [
    "core.mjs",
    "server.mjs",
    "setup.mjs",
    "mcp.json",
    "plugin.json",
    ".codex-plugin/",
    "skills/",
    "README.md",
    "LICENSE",
    "CHANGELOG.md",
    ".env.example"
  ],
  "scripts": {
    "start": "node server.mjs",
    "setup": "node setup.mjs",
    "test": "node --test test/*.test.mjs"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "imapflow": "^1.0.0",
    "mailparser": "^3.0.0",
    "node-pop3": "^0.15.3",
    "nodemailer": "10.0.15",
    "zod": "^3.25.0"
  }
}
```

> ⚠️ Note: `bin` points to `server.mjs`. For `npx @susheelhbti/mcp-support-si` to work as an MCP server, `server.mjs` must have a shebang. Add `#!/usr/bin/env node` as the very first line of `server.mjs` (see §3).

---

## 2. `core.mjs`

```js
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import Pop3Command from 'node-pop3';
import { simpleParser } from 'mailparser';

const root = path.dirname(fileURLToPath(import.meta.url));
const base = path.join(os.homedir(), '.mcp-support-si');

export function config(env = process.env) {
  const port = (name, fallback) => {
    const value = Number(env[name] || fallback);
    if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`Invalid ${name}`);
    return value;
  };
  const security = env.MCP_SI_SMTP_SECURITY || 'tls';
  if (!['tls', 'starttls'].includes(security)) throw new Error('SMTP security must be tls or starttls');
  const nonNegInt = (name, fallback = 0) => {
    const v = Number(env[name] ?? fallback);
    if (!Number.isInteger(v) || v < 0) throw new Error(`Invalid ${name}`);
    return v;
  };
  return {
    user: env.MCP_SI_MAIL_USER, password: env.MCP_SI_MAIL_PASSWORD, token: env.MCP_SI_ACCESS_TOKEN,
    from: env.MCP_SI_FROM || env.MCP_SI_MAIL_USER,
    imapHost: env.MCP_SI_IMAP_HOST, imapPort: port('MCP_SI_IMAP_PORT', 993),
    smtpHost: env.MCP_SI_SMTP_HOST, smtpPort: port('MCP_SI_SMTP_PORT', 465), security,
    popHost: env.MCP_SI_POP3_HOST, popPort: port('MCP_SI_POP3_PORT', 995),
    dataDir: path.resolve(env.MCP_SI_DATA_DIR || path.join(root, 'skills/mcp-support-si-reply/data')),
    stateDir: path.resolve(env.MCP_SI_STATE_DIR || path.join(base, 'state')),
    enableSend: env.MCP_SI_ENABLE_SEND === 'true',
    maxSendsPerHour: nonNegInt('MCP_SI_MAX_SENDS_PER_HOUR', 0),
    maxDraftsPerHour: nonNegInt('MCP_SI_MAX_DRAFTS_PER_HOUR', 0)
  };
}

export function loadEnvironment() {
  const file = process.env.MCP_SI_ENV_FILE || path.join(base, '.env');
  try { process.loadEnvFile(file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
}

export function header(value) {
  if (typeof value !== 'string' || /[\r\n\0]/.test(value)) throw new Error('Invalid header or protocol value');
  return value;
}

export function address(value) {
  header(value);
  if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(value)) throw new Error('Use one plain email address');
  return value;
}

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const now = () => new Date().toISOString();
const MAX_MESSAGE = 10 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class Store {
  constructor(dir) { this.dir = dir; }
  file(kind, id) {
    if (!['drafts', 'tickets', 'sends'].includes(kind) || !UUID_RE.test(id)) throw new Error('Invalid record ID');
    return path.join(this.dir, kind, `${id}.json`);
  }
  async put(kind, record, exclusive = false) {
    const file = this.file(kind, record.id);
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    if (exclusive) {
      await fs.writeFile(file, JSON.stringify(record, null, 2), { flag: 'wx', mode: 0o600 });
    } else {
      const temp = `${file}.${randomUUID()}.tmp`;
      const fh = await fs.open(temp, 'w', 0o600);
      try {
        await fh.writeFile(JSON.stringify(record, null, 2));
        await fh.sync();
      } finally { await fh.close(); }
      await fs.rename(temp, file);
    }
    return record;
  }
  async get(kind, id) { return JSON.parse(await fs.readFile(this.file(kind, id), 'utf8')); }
  async list(kind) {
    const folder = path.join(this.dir, kind);
    let files;
    try { files = await fs.readdir(folder); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    const rows = [];
    for (const file of files.filter(f => f.endsWith('.json'))) rows.push(await this.get(kind, file.slice(0, -5)));
    return rows.sort((a, b) => b.updated.localeCompare(a.updated));
  }
}

// Only explicitly active records become approved knowledge.
// Returns { records, errors } so one bad record doesn't void the whole file.
export function activeRecords(value, inheritedDate, trail = '') {
  const records = [], errors = [];
  const walk = (v, date, loc) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach((item, i) => walk(item, date, `${loc}/${i}`)); return; }
    if (v.active === false) return;
    const updated = v.updated || date;
    if (v.active === true) {
      if (!updated || !/^\d{4}-\d{2}-\d{2}/.test(updated)) {
        errors.push({ location: loc, error: 'Active record missing updated date' });
        return;
      }
      const clean = x => Array.isArray(x) ? x.filter(y => y?.active !== false).map(clean)
        : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).filter(([, y]) => y?.active !== false).map(([k, y]) => [k, clean(y)])) : x;
      records.push({ location: loc, updated, record: clean(v) });
      return;
    }
    Object.entries(v).forEach(([k, child]) => walk(child, updated, `${loc}/${k}`));
  };
  walk(value, inheritedDate, trail);
  return { records, errors };
}

export async function knowledge(dir, query = '', limit = 30) {
  const records = [], errors = [];
  const boundary = await fs.realpath(dir);
  async function visit(folder) {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(folder, entry.name);
      const real = await fs.realpath(file);
      if (!real.startsWith(boundary + path.sep)) continue;
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && entry.name.endsWith('.json')) {
        const relative = path.relative(dir, file);
        try {
          if ((await fs.stat(file)).size > 1024 * 1024) throw new Error('JSON exceeds 1 MB');
          const parsed = activeRecords(JSON.parse(await fs.readFile(file, 'utf8')));
          records.push(...parsed.records.map(r => ({ file: relative, ...r })));
          errors.push(...parsed.errors.map(e => ({ file: relative, ...e })));
        } catch (e) { errors.push({ file: relative, error: e.message }); }
      }
    }
  }
  await visit(dir);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matching = records.filter(r => !terms.length || terms.some(t => JSON.stringify(r).toLowerCase().includes(t)));
  const result = { records: matching.slice(0, limit), total: matching.length, errors, incomplete: errors.length > 0 };
  if (!matching.length) result.hint = 'No approved records matched. Broaden the query or ask the user to add data to MCP_SI_DATA_DIR.';
  return result;
}

export async function parseMessage(raw) {
  if (Buffer.byteLength(raw) > MAX_MESSAGE) throw new Error('Message exceeds 10 MB');
  const parsed = await simpleParser(raw, { skipHtmlToText: false, skipTextToHtml: true });
  const safeName = n => (n || '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 255);
  return {
    messageId: parsed.messageId, references: parsed.references,
    from: parsed.from?.value || [], to: parsed.to?.value || [], replyTo: parsed.replyTo?.value || [],
    subject: parsed.subject || '', date: parsed.date?.toISOString(),
    text: (parsed.text || '').slice(0, 60000), truncated: (parsed.text || '').length > 60000,
    attachments: parsed.attachments.map((a, i) => ({ index: i, name: safeName(a.filename), type: a.contentType, size: a.size })),
    untrustedContent: true
  };
}

export class Mail {
  constructor(cfg, factories = {}) {
    this.cfg = cfg;
    this.factories = { imap: options => new ImapFlow(options), pop: options => new Pop3Command(options),
      smtp: options => nodemailer.createTransport(options), ...factories };
  }
  credentials() {
    const c = this.cfg;
    if (!c.user || (!c.password && !c.token)) throw new Error('Configure mail username and password or access token locally');
    header(c.user);
    return c.token ? { user: c.user, accessToken: c.token } : { user: c.user, pass: c.password };
  }
  async imap(folder, action, validity) {
    const c = this.cfg;
    if (!c.imapHost) throw new Error('Configure MCP_SI_IMAP_HOST');
    const client = this.factories.imap({ host: c.imapHost, port: c.imapPort, secure: true,
      auth: this.credentials(), logger: false, connectionTimeout: 15000, socketTimeout: 30000 });
    client.on('error', () => {});
    try {
      await client.connect();
      if (!folder) return await action(client);
      const lock = await client.getMailboxLock(header(folder));
      try {
        if (validity && String(client.mailbox.uidValidity) !== validity) throw new Error('Mailbox UIDVALIDITY changed; list messages again');
        return await action(client);
      } finally { lock.release(); }
    } finally { await client.logout().catch(() => client.close()); }
  }
  async list({ folder = 'INBOX', unreadOnly = false, query = '', offset = 0, limit = 20 }) {
    return this.imap(folder, async client => {
      const search = { all: true, ...(unreadOnly ? { seen: false } : {}), ...(query ? { body: query } : {}) };
      const all = await client.search(search, { uid: true });
      const ids = (all || []).reverse().slice(offset, offset + limit);
      const messages = [];
      if (ids.length) for await (const m of client.fetch(ids, { envelope: true, flags: true, size: true }, { uid: true })) {
        messages.push({ uid: m.uid, folder, uidValidity: String(client.mailbox.uidValidity), envelope: m.envelope, flags: [...m.flags], size: m.size });
      }
      return { messages: messages.sort((a, b) => b.uid - a.uid), total: (all || []).length, offset };
    });
  }
  async raw(ref) {
    return this.imap(ref.folder, async client => {
      const meta = await client.fetchOne(ref.uid, { size: true }, { uid: true });
      if (!meta) throw new Error('Message no longer exists');
      if (meta.size > MAX_MESSAGE) throw new Error('Message exceeds 10 MB');
      const m = await client.fetchOne(ref.uid, { source: true }, { uid: true });
      if (!m?.source) throw new Error('Message no longer exists');
      return m.source;
    }, ref.uidValidity);
  }
  async read(ref) { return { ...ref, ...await parseMessage(await this.raw(ref)) }; }
  async folders() { return this.imap(null, async c => (await c.list()).map(f => ({ path: f.path, specialUse: f.specialUse }))); }
  async createFolder(folder) { return this.imap(null, c => c.mailboxCreate(header(folder))); }
  async flags(ref, flag, enabled) {
    return this.imap(ref.folder, async c => {
      if (!await c.fetchOne(ref.uid, { uid: true }, { uid: true })) throw new Error('Message not found');
      return enabled ? c.messageFlagsAdd(ref.uid, [flag], { uid: true }) : c.messageFlagsRemove(ref.uid, [flag], { uid: true });
    }, ref.uidValidity);
  }
  async move(ref, destination) {
    return this.imap(ref.folder, async c => {
      if (!c.capabilities.has('MOVE')) throw new Error('Server lacks atomic MOVE; no messages changed');
      if (!await c.fetchOne(ref.uid, { uid: true }, { uid: true })) throw new Error('Message not found');
      const result = await c.messageMove(ref.uid, header(destination), { uid: true });
      if (!result) throw new Error('Move failed');
      return { moved: true, destination, uidValidity: String(result.uidValidity || ''), uidMap: result.uidMap ? [...result.uidMap] : [] };
    }, ref.uidValidity);
  }
  async pop(action) {
    const c = this.cfg;
    if (!c.popHost || !c.user || !c.password) throw new Error('Configure POP3 host, username and password');
    header(c.user); header(c.password);
    const client = this.factories.pop({ host: c.popHost, port: c.popPort, user: c.user, password: c.password,
      tls: true, tlsOptions: { rejectUnauthorized: true }, timeout: 20000, streamReadTimeout: 30000, maxMailSize: MAX_MESSAGE });
    try { return await action(client); } finally { await client.QUIT().catch(() => {}); }
  }
  async popList(offset = 0, limit = 20) {
    return this.pop(async c => {
      const rows = await c.UIDL();
      return { messages: rows.slice().reverse().slice(offset, offset + limit).map(([, uidl]) => ({ uidl })), total: rows.length };
    });
  }
  async popRead(uidl) {
    return this.pop(async c => {
      const rows = await c.UIDL();
      const row = rows.find(([, id]) => id === uidl);
      if (!row) throw new Error('POP3 message not found');
      return { uidl, ...await parseMessage(await c.RETR(row[0])) };
    });
  }
  transport() {
    const c = this.cfg;
    if (!c.smtpHost) throw new Error('Configure MCP_SI_SMTP_HOST');
    const auth = this.credentials();
    return this.factories.smtp({ host: c.smtpHost, port: c.smtpPort, secure: c.security === 'tls',
      requireTLS: c.security === 'starttls', auth: c.token ? { type: 'OAuth2', ...auth } : auth,
      connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
      disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false });
  }
  async send(draft) {
    const transport = this.transport();
    try { return await transport.sendMail({ from: address(this.cfg.from), to: draft.to, subject: draft.subject,
      text: draft.body, messageId: draft.messageId, inReplyTo: draft.inReplyTo, references: draft.references }); }
    finally { transport.close(); }
  }
}

export class Support {
  constructor(cfg, mail = new Mail(cfg)) { this.cfg = cfg; this.mail = mail; this.store = new Store(cfg.stateDir); }
  async draft({ to, subject, body, replyTo, popUidl, ticketId }) {
    if (replyTo && popUidl) throw new Error('Choose one source message');
    let source;
    if (replyTo) source = await this.mail.read(replyTo);
    if (popUidl) source = await this.mail.popRead(popUidl);
    if (!source && !subject) throw new Error('Subject required when not replying to a message');
    const target = to || source?.replyTo?.[0]?.address || source?.from?.[0]?.address;
    const id = randomUUID();
    if (ticketId) await this.store.get('tickets', ticketId);
    const fromDomain = address(this.cfg.from).split('@')[1];
    const record = { id, to: address(target), subject: header(subject || (source ? `Re: ${source.subject.replace(/^Re:\s*/i, '')}` : '')),
      body, ticketId, replyTo, popUidl, inReplyTo: source?.messageId,
      references: source ? [...(Array.isArray(source.references) ? source.references : source.references ? [source.references] : []), source.messageId].filter(Boolean) : [],
      messageId: `<${id}@${fromDomain}>`, updated: now() };
    record.version = digest(record);
    await this.store.put('drafts', record, true);
    if (ticketId) {
      try {
        const ticket = await this.store.get('tickets', ticketId);
        ticket.drafts = [...(ticket.drafts || []), { id, subject: record.subject, updated: record.updated }];
        ticket.updated = new Date(Math.max(Date.now(), Date.parse(ticket.updated) + 1)).toISOString();
        await this.store.put('tickets', ticket);
      } catch { /* ticket link is best-effort; the draft is already durable */ }
    }
    return record;
  }
  async send(id, version, authorized) {
    if (!this.cfg.enableSend) throw new Error('Sending disabled; set MCP_SI_ENABLE_SEND=true locally');
    if (!authorized) throw new Error('Sending requires user authorization for this draft');
    const draft = await this.store.get('drafts', id);
    if (draft.version !== version) throw new Error('Draft version mismatch; review the current draft');
    await this._enforceSendBudget();
    const record = { id, updated: now(), status: 'sending', messageId: draft.messageId };
    try { await this.store.put('sends', record, true); }
    catch (e) {
      if (e.code === 'EEXIST') return { ...await this.store.get('sends', id), duplicatePrevented: true };
      throw e;
    }
    try {
      const result = await this.mail.send(draft);
      record.status = result.accepted?.length ? 'accepted_by_smtp' : 'rejected';
      record.accepted = result.accepted; record.rejected = result.rejected;
    } catch {
      record.status = 'delivery_unknown';
      record.nextStep = 'Check the provider Sent folder/logs before creating another draft. Automatic retry is blocked.';
    }
    record.updated = now();
    await this.store.put('sends', record);
    return record;
  }
  async _enforceSendBudget() {
    const limit = this.cfg.maxSendsPerHour || 0;
    if (!limit) return;
    const since = Date.now() - 3600_000;
    const recent = (await this.store.list('sends')).filter(r => Date.parse(r.updated) >= since && r.status !== 'sending').length;
    if (recent >= limit) throw new Error(`Sending rate limit reached (${limit}/hour). Wait before sending.`);
  }
  async ticketCreate({ customer, subject, summary, source, priority = 'normal' }) {
    return this.store.put('tickets', { id: randomUUID(), customer: address(customer), subject, summary, source,
      priority, status: 'open', notes: [], drafts: [], created: now(), updated: now() }, true);
  }
  async ticketUpdate({ id, status, priority, note, expectedUpdated }) {
    const record = await this.store.get('tickets', id);
    if (expectedUpdated !== record.updated) throw new Error('Ticket changed; reload it first');
    if (status) record.status = status;
    if (priority) record.priority = priority;
    if (note) record.notes.push({ date: now(), text: note });
    record.updated = new Date(Math.max(Date.now(), Date.parse(record.updated) + 1)).toISOString();
    return this.store.put('tickets', record);
  }
}
```

> 🔁 **Env var prefix changed from `NOXR_` to `MCP_SI_`.** If you have an existing `.env`, rename those keys. The state dir is now `~/.mcp-support-si/`.

---

## 3. `server.mjs`

The very first line must be the shebang so `npx` and `bin` work.

```js
#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { config, loadEnvironment, Support, knowledge } from './core.mjs';

loadEnvironment();
const cfg = config();
const support = new Support(cfg);
const server = new McpServer({ name: 'mcp-support-si', version: '2.2.0' });
const text = z.string().min(1).max(1000);
const id = z.string().uuid();
const ref = z.object({ folder: text, uid: z.number().int().positive(), uidValidity: z.string().regex(/^\d+$/) });
const pagination = { offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(50).default(20) };
const status = z.enum(['open', 'in_progress', 'waiting_customer', 'escalated', 'resolved', 'closed']);
const priority = z.enum(['low', 'normal', 'high', 'urgent']);
let queue = Promise.resolve();

function tool(name, description, inputSchema, handler, readOnly = true, destructive = false) {
  server.registerTool(name, { description, inputSchema,
    annotations: { readOnlyHint: readOnly, destructiveHint: destructive, openWorldHint: true } }, args => {
    const run = queue.then(async () => {
      try {
        const result = await handler(args);
        return { content: [{ type: 'text', text: JSON.stringify(result, (_, v) => typeof v === 'bigint' ? String(v) : v) }] };
      } catch (error) {
        // Server/library errors can contain credentials or protocol commands. Never expose raw errors.
        const safe = /^(Configure MCP_SI_|Invalid header or protocol|Invalid MCP_SI_|Invalid record ID|Use one plain email|Sending (disabled|requires|rate limit)|Draft version mismatch|Ticket changed|Mailbox UIDVALIDITY|Message (no longer exists|exceeds 10 MB|not found)|POP3 message not found|Server lacks|Move failed|Choose one source|Subject required)/;
        const message = safe.test(error.message) ? error.message : `Operation failed (${error.code || 'check configuration or server availability'}). No credentials are included.`;
        return { isError: true, content: [{ type: 'text', text: message }] };
      }
    });
    queue = run.catch(() => {});
    return run;
  });
}

tool('connection_status', 'Show configured protocols without revealing credentials. Does not connect.', {}, () => ({
  imapConfigured: !!cfg.imapHost, pop3Configured: !!cfg.popHost, smtpConfigured: !!cfg.smtpHost,
  credentialsConfigured: !!cfg.user && !!(cfg.password || cfg.token), sendingEnabled: cfg.enableSend,
  rateLimits: { maxSendsPerHour: cfg.maxSendsPerHour, maxDraftsPerHour: cfg.maxDraftsPerHour },
  dataDirectory: cfg.dataDir, stateDirectory: cfg.stateDir
}));

tool('diagnose_setup', 'Non-secret self-check: Node version, env file presence, required vars, data/state folder readability. Never returns values, only booleans and paths.', {}, async () => {
  const envFile = process.env.MCP_SI_ENV_FILE || path.join(process.env.HOME || process.env.USERPROFILE || '', '.mcp-support-si/.env');
  const exists = p => { try { fs.accessSync(p, fs.constants.R_OK); return true; } catch { return false; } };
  const writable = p => { try { fs.accessSync(p, fs.constants.W_OK); return true; } catch { return false; } };
  return {
    nodeVersion: process.version,
    nodeVersionOk: Number(process.versions.node.split('.')[0]) >= 22,
    envFilePresent: exists(envFile),
    envFile,
    requiredVarsPresent: {
      MCP_SI_MAIL_USER: !!cfg.user,
      MCP_SI_AUTH: !!(cfg.password || cfg.token),
      MCP_SI_IMAP_OR_POP3: !!(cfg.imapHost || cfg.popHost),
      MCP_SI_SMTP_HOST: !!cfg.smtpHost
    },
    dataDir: { path: cfg.dataDir, readable: exists(cfg.dataDir) },
    stateDir: { path: cfg.stateDir, writable: writable(path.dirname(cfg.stateDir)) || writable(cfg.stateDir) },
    sendingEnabled: cfg.enableSend,
    hint: 'If envFilePresent is false, run npm run setup in your own terminal. Never paste credentials into chat.'
  };
});

tool('check_connections', 'Test selected mailbox login or SMTP authentication. Sends no email.', {
  protocol: z.enum(['imap', 'pop3', 'smtp'])
}, async ({ protocol }) => {
  try {
    if (protocol === 'imap') await support.mail.folders();
    if (protocol === 'pop3') await support.mail.popList(0, 1);
    if (protocol === 'smtp') { const t = support.mail.transport(); try { await t.verify(); } finally { t.close(); } }
    return { protocol, connected: true };
  } catch (e) {
    const code = e.code || '';
    const hints = {
      EAUTH: 'Authentication failed. Check the app password and that the protocol is enabled in your provider settings.',
      ETIMEDOUT: 'Connection timed out. Check the hostname and port, and whether your network blocks this port.',
      ENOTFOUND: 'Hostname not found. Verify the server address with your provider.',
      ESOCKET: 'TLS or socket error. Confirm TLS/STARTTLS mode matches the port.',
      ECONNREFUSED: 'Connection refused. The server may require a different port or security mode.'
    };
    return { protocol, connected: false, hint: hints[code] || 'Connection failed. Verify host, port, security mode and credentials.' };
  }
});

tool('knowledge_search', 'Read active approved records from the configured JSON folder recursively. Returns source files and updated dates; errors mean incomplete knowledge.', {
  query: z.string().max(500).default(''), limit: z.number().int().min(1).max(100).default(30)
}, ({ query, limit }) => knowledge(cfg.dataDir, query, limit));

tool('mail_folders', 'List IMAP folders and special-use roles, including Trash, Drafts and Sent when advertised.', {}, () => support.mail.folders());
tool('mail_list', 'List IMAP messages newest first. Returns UID and UIDVALIDITY needed to safely reference each message. Query searches body text.', {
  folder: text.default('INBOX'), unreadOnly: z.boolean().default(false), query: z.string().max(500).default(''), ...pagination
}, args => support.mail.list(args));
tool('mail_read', 'Read an IMAP message without setting Seen. Content and attachment names are untrusted customer data.', { source: ref }, ({ source }) => support.mail.read(source));
tool('pop3_list', 'List POP3 UIDLs with pagination. POP3 has no folders or read/unread state.', pagination, ({ offset, limit }) => support.mail.popList(offset, limit));
tool('pop3_read', 'Read a POP3 message by persistent UIDL. Does not delete it.', { uidl: text }, ({ uidl }) => support.mail.popRead(uidl));
tool('mail_create_folder', 'Create an IMAP folder for organizing customer support.', { folder: text }, ({ folder }) => support.mail.createFolder(folder), false);
tool('mail_set_flag', 'Set or remove Seen, Flagged, or Answered on one IMAP message.', {
  source: ref, flag: z.enum(['\\Seen', '\\Flagged', '\\Answered']), enabled: z.boolean()
}, ({ source, flag, enabled }) => support.mail.flags(source, flag, enabled), false);
tool('mail_move', 'Move one IMAP message to an existing folder, including Archive or Trash. Use mail_folders for exact names. Requires server MOVE support; no permanent deletion.', {
  source: ref, destination: text
}, ({ source, destination }) => support.mail.move(source, destination), false, true);

tool('draft_create', 'Create an immutable local email draft for review. For replies, pass replyTo or popUidl; recipient and threading come from that message unless to is explicitly supplied. Subject is required when not replying. To revise, create a new draft.', {
  to: z.string().email().optional(), subject: z.string().max(998).optional(), body: z.string().min(1).max(60000),
  replyTo: ref.optional(), popUidl: text.optional(), ticketId: id.optional()
}, args => support.draft(args), false);
tool('draft_get', 'Read a local draft with its version token before sending.', { id }, ({ id }) => support.store.get('drafts', id));
tool('draft_preview', 'Render a draft exactly as the recipient will see it: From, To, Subject, threading headers, body.', { id }, async ({ id }) => {
  const d = await support.store.get('drafts', id);
  return { id: d.id, from: support.cfg.from, to: d.to, subject: d.subject, inReplyTo: d.inReplyTo, references: d.references, body: d.body, version: d.version, updated: d.updated };
});
tool('draft_list', 'List local draft summaries.', pagination, async ({ offset, limit }) => {
  const rows = await support.store.list('drafts');
  return { total: rows.length, drafts: rows.slice(offset, offset + limit).map(({ id, to, subject, updated, ticketId }) => ({ id, to, subject, updated, ticketId })) };
});
tool('draft_send', 'Send an exact reviewed draft by SMTP only when the human user authorized sending. Pass its current version. A durable record prevents repeated delivery attempts. SMTP acceptance is not delivery confirmation.', {
  id, version: z.string().regex(/^[a-f0-9]{64}$/), authorized: z.boolean()
}, ({ id, version, authorized }) => support.send(id, version, authorized), false, true);
tool('send_status', 'Check the durable send result. delivery_unknown or sending must be verified with the provider before any new attempt.', { id }, ({ id }) => support.store.get('sends', id));

tool('ticket_create', 'Create a local complaint case linked to an email reference. No refund or order system is changed.', {
  customer: z.string().email(), subject: text, summary: z.string().min(1).max(10000), source: z.union([ref, z.object({ uidl: text })]).optional(), priority: priority.default('normal')
}, args => support.ticketCreate(args), false);
tool('ticket_get', 'Read complaint details, notes, related drafts and status.', { id }, ({ id }) => support.store.get('tickets', id));
tool('ticket_list', 'List complaint cases, optionally by status.', { status: status.optional(), ...pagination }, async ({ status, offset, limit }) => {
  const rows = (await support.store.list('tickets')).filter(r => !status || r.status === status);
  return { total: rows.length, tickets: rows.slice(offset, offset + limit) };
});
tool('ticket_update', 'Update case status/priority or append an internal note. Use the updated timestamp from ticket_get. This is local recordkeeping, not proof of a refund or resolution.', {
  id, expectedUpdated: text, status: status.optional(), priority: priority.optional(), note: z.string().max(10000).optional()
}, args => support.ticketUpdate(args), false);

await server.connect(new StdioServerTransport());
```

---

## 4. `setup.mjs`

```js
#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline/promises';
import { Writable } from 'node:stream';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { address, config, Mail } from './core.mjs';

export const providers = {
  gmail: { imap: 'imap.gmail.com', smtp: 'smtp.gmail.com', port: '465', security: 'tls' },
  outlook: { imap: 'outlook.office365.com', smtp: 'smtp-mail.outlook.com', port: '587', security: 'starttls', oauth: true },
  microsoft365: { imap: 'outlook.office365.com', smtp: 'smtp.office365.com', port: '587', security: 'starttls', oauth: true },
  zoho: { imap: 'imap.zoho.com', smtp: 'smtp.zoho.com', port: '465', security: 'tls' },
  'zoho-business': { imap: 'imappro.zoho.com', smtp: 'smtppro.zoho.com', port: '465', security: 'tls' },
  yahoo: { imap: 'imap.mail.yahoo.com', smtp: 'smtp.mail.yahoo.com', port: '465', security: 'tls' },
  icloud: { imap: 'imap.mail.me.com', smtp: 'smtp.mail.me.com', port: '587', security: 'starttls' },
  fastmail: { imap: 'imap.fastmail.com', smtp: 'smtp.fastmail.com', port: '465', security: 'tls' },
  gmx: { imap: 'imap.gmx.com', smtp: 'mail.gmx.com', port: '587', security: 'starttls' },
  yandex: { imap: 'imap.yandex.com', smtp: 'smtp.yandex.com', port: '465', security: 'tls' },
  custom: { imap: '', smtp: '', port: '465', security: 'tls' }
};

function hostname(value) {
  if (!/^[a-zA-Z0-9.-]+$/.test(value) || value.startsWith('.') || value.endsWith('.')) throw new Error('Enter a mail server hostname, without a URL or port.');
  return value;
}

export function buildSettings(previous, input) {
  const settings = { ...previous,
    MCP_SI_MAIL_USER: address(input.email), MCP_SI_FROM: address(input.email),
    MCP_SI_MAIL_PASSWORD: input.oauth ? '' : input.secret,
    MCP_SI_ACCESS_TOKEN: input.oauth ? input.secret : '',
    MCP_SI_IMAP_HOST: input.imap ? hostname(input.imap) : '', MCP_SI_IMAP_PORT: String(input.imapPort || 993),
    MCP_SI_SMTP_HOST: hostname(input.smtp), MCP_SI_SMTP_PORT: String(input.smtpPort), MCP_SI_SMTP_SECURITY: input.security,
    MCP_SI_POP3_HOST: input.pop ? hostname(input.pop) : '', MCP_SI_POP3_PORT: String(input.popPort || 995),
    MCP_SI_ENABLE_SEND: 'false'
  };
  if (!input.imap && !input.pop) throw new Error('Configure IMAP or POP3 for incoming email.');
  if (input.pop && input.oauth) throw new Error('This plugin supports POP3 password authentication only. Use IMAP with OAuth.');
  config(settings);
  return settings;
}

export function serialize(settings) {
  return '# Private MCP Support SI settings. Never share or commit this file.\n' + Object.entries(settings).map(([key, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error('Invalid environment variable name');
    value = String(value);
    if (/[\r\n\0]/.test(value)) throw new Error('Settings must be single-line values');
    const quote = ["'", '"', '`'].find(q => !value.includes(q));
    if (!quote) throw new Error('A value contains all three quote styles. Supply it through an environment variable instead.');
    return `${key}=${quote}${value}${quote}`;
  }).join('\n') + '\n';
}

export async function saveSettings(file, settings) {
  const data = serialize(settings);
  const parsed = parseEnv(data);
  if (Object.keys(parsed).length !== Object.keys(settings).length || Object.entries(settings).some(([key, value]) => parsed[key] !== String(value))) throw new Error('A setting could not be encoded safely');
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, data, { flag: 'wx', mode: 0o600 });
    await fs.rename(temp, file);
  } finally { await fs.unlink(temp).catch(() => {}); }
}

export async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run npm run setup in your own interactive terminal. Do not send credentials through chat or captured tool input.');
  const file = process.env.MCP_SI_ENV_FILE || path.join(os.homedir(), '.mcp-support-si/.env');
  let previous = {};
  try { previous = parseEnv(await fs.readFile(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  let muted = false;
  const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); } });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
  const ask = async (label, fallback = '') => (await rl.question(`${label}${fallback ? ` [${fallback}]` : ''}: `)).trim() || fallback;
  try {
    console.log('MCP Support SI — local setup. Secrets stay in this terminal and the local settings file.');
    console.log('Choose: ' + Object.keys(providers).join(', '));
    const name = (await ask('Provider', 'custom')).toLowerCase();
    const preset = providers[name];
    if (!preset) throw new Error('Unknown provider. Run setup again and select a listed provider.');
    if (preset.oauth) console.log('Microsoft requires OAuth for this setup. This plugin cannot acquire/refresh tokens. Obtain an IMAP/SMTP access token externally, or leave it blank and finish OAuth setup later.');
    else console.log('Use a provider-issued app password where available, never your main account password. Check that IMAP/SMTP access is enabled for your account.');
    if (name.startsWith('zoho')) console.log('Zoho hosts vary by region and account plan. Confirm your exact hosts in Zoho account settings.');
    const email = await ask('Email address', previous.MCP_SI_MAIL_USER || '');
    const imap = await ask('IMAP hostname (enter - to use POP3 instead)', preset.imap);
    const imapPort = imap === '-' ? '993' : await ask('IMAP TLS port', '993');
    const pop = imap === '-' ? await ask('POP3 TLS hostname') : '';
    const popPort = pop ? await ask('POP3 TLS port', '995') : '995';
    const smtp = await ask('SMTP hostname', preset.smtp);
    const smtpPort = await ask('SMTP port', preset.port);
    const security = await ask('SMTP security (tls or starttls)', preset.security);
    console.log(`Settings: ${email}; incoming ${imap === '-' ? pop + ':' + popPort : imap + ':' + imapPort}; outgoing ${smtp}:${smtpPort} (${security}).`);
    if ((await ask('Confirm these server addresses before entering a secret? yes/no', 'no')).toLowerCase() !== 'yes') { console.log('Cancelled; nothing saved.'); return; }
    process.stdout.write(preset.oauth ? 'OAuth access token (hidden; blank to configure later): ' : 'App password (hidden; blank to configure later): ');
    muted = true;
    let secret;
    try { secret = await rl.question(''); } finally { muted = false; process.stdout.write('\n'); }
    const settings = buildSettings(previous, { email, imap: imap === '-' ? '' : imap, imapPort, pop, popPort, smtp, smtpPort, security, oauth: !!preset.oauth, secret });
    const dataDir = await ask('JSON knowledge folder (absolute path, or blank for packaged data)', previous.MCP_SI_DATA_DIR || '');
    if (dataDir && !path.isAbsolute(dataDir)) throw new Error('The JSON folder must be an absolute path.');
    settings.MCP_SI_DATA_DIR = dataDir;
    if (dataDir && !(await fs.stat(dataDir)).isDirectory()) throw new Error('The JSON folder is not a directory.');
    console.log(`Save to ${file}. Existing non-mail settings are preserved; sending will be disabled.`);
    if ((await ask('Save settings? yes/no', 'no')).toLowerCase() !== 'yes') { console.log('Cancelled; nothing saved.'); return; }
    await saveSettings(file, settings);
    console.log('Saved. Sending is disabled. Restart your MCP host to load these settings.');
    if (secret && (await ask('Test incoming and SMTP login now (sends no email)? yes/no', 'no')).toLowerCase() === 'yes') {
      const mail = new Mail(config(settings));
      try {
        if (settings.MCP_SI_IMAP_HOST) await mail.folders(); else await mail.popList(0, 1);
        const transport = mail.transport();
        try { await transport.verify(); } finally { transport.close(); }
        console.log('Incoming and SMTP login passed. No email sent.');
      } catch { console.log('Login check failed. Confirm provider settings, account permissions and authentication. No email was sent; saved settings remain available to correct.'); }
    }
    if (secret && (await ask('Send a test email from your account to yourself? yes/no', 'no')).toLowerCase() === 'yes') {
      const mail = new Mail(config(settings));
      const transport = mail.transport();
      try {
        await transport.sendMail({ from: address(settings.MCP_SI_FROM), to: address(settings.MCP_SI_FROM),
          subject: 'MCP Support SI setup test', text: 'If you received this, outbound SMTP works.' });
        console.log('Test email accepted by SMTP. Check your inbox.');
      } catch { console.log('Test email failed. Check SMTP settings and provider sending permissions.'); }
      finally { transport.close(); }
    }
  } finally { muted = false; rl.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Setup could not finish. Check input values, folder permissions and provider settings, then run again. Secrets are not logged.'); process.exitCode = 1; });
}
```

---

## 5. `plugin.json`

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "mcp-support-si",
  "version": "2.2.0",
  "description": "MCP Support SI — customer support email: IMAP/POP3 inbox, SMTP replies, complaint tracking and approved JSON knowledge."
}
```

---

## 6. `.codex-plugin/plugin.json`

```json
{
  "name": "mcp-support-si",
  "version": "2.2.0",
  "description": "MCP Support SI — email and complaint handling",
  "skills": "./skills/",
  "mcpServers": "./mcp.json"
}
```

---

## 7. `mcp.json`

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": {
    "mcp-support-si": {
      "type": "stdio",
      "command": "node",
      "args": ["${PLUGIN_ROOT}/server.mjs"],
      "cwd": "${PLUGIN_ROOT}"
    }
  }
}
```

---

## 8. `README.md`

```markdown
# MCP Support SI (Super Intelligent)

[![CI](https://github.com/susheelhbti/mcp-support-si/actions/workflows/ci.yml/badge.svg)](https://github.com/susheelhbti/mcp-support-si/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node >=22](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)

Local Model Context Protocol server for customer support email. Node.js 22+ required.
The host assistant writes the replies; this server provides mailbox access, business
knowledge and case records. No separate AI API key is needed.

## Install

```sh
npx @susheelhbti/mcp-support-si
```

Or register with Codex directly:

```sh
codex mcp add mcp-support-si -- npx -y @susheelhbti/mcp-support-si
```

Or install from source:

```sh
git clone https://github.com/susheelhbti/mcp-support-si.git
cd mcp-support-si
npm ci --ignore-scripts
npm run setup
```

## Why this is safe to hand to an LLM

- **Durable send lock.** A draft can only be sent once, even across restarts or
  concurrent processes. Uncertain SMTP outcomes block retries until you verify
  with your provider.
- **No raw error leakage.** Library and protocol errors are filtered; only a
  whitelist of safe messages reaches the model. Credentials never appear in output.
- **Untrusted content flag.** Every message body and attachment name is marked as
  untrusted customer data so the agent treats it accordingly.
- **Immutable drafts.** Drafts cannot be edited in place; revisions create a new
  version with a new hash. The send tool requires the exact reviewed version.
- **Mailbox integrity checks.** UIDVALIDITY is verified before every UID operation,
  so a renumbered mailbox cannot cause the wrong message to be moved or flagged.
- **Optional rate limits.** Set `MCP_SI_MAX_SENDS_PER_HOUR` to cap outbound volume.

## Setup

You need Node.js 22+ and an account whose provider permits IMAP or POP3 plus SMTP.
Each user connects their own account; the package includes no credentials.

In your own terminal, open the plugin's directory and run:

```sh
npm ci --ignore-scripts
npm run setup
```

The wizard supplies provider defaults, asks you to confirm the servers, accepts a
hidden local app password/token, and asks for your JSON folder. It saves settings
without manual file editing. Credentials never need to enter chat. You can leave
the secret blank to finish authentication later. Running setup again replaces the
mail settings, preserves other environment keys, and disables sending.

Restart your MCP host after saving, then ask **"Check my email connection."**
The optional wizard login check and the `check_connections` tool send no email.

### Provider notes

| Provider | IMAP TLS (993) | SMTP | Notes |
| --- | --- | --- | --- |
| Gmail | imap.gmail.com | smtp.gmail.com:465 TLS | App passwords need 2-Step Verification; may be restricted by admin policy |
| Outlook.com | outlook.office365.com | smtp-mail.outlook.com:587 STARTTLS | Requires OAuth2; no built-in OAuth sign-in |
| Microsoft 365 | outlook.office365.com | smtp.office365.com:587 STARTTLS | OAuth and tenant/mailbox permissions required |
| Zoho personal | imap.zoho.com | smtp.zoho.com:465 TLS | Verify region and plan |
| Zoho business | imappro.zoho.com | smtppro.zoho.com:465 TLS | Regional hosts can differ |
| Yahoo | imap.mail.yahoo.com | smtp.mail.yahoo.com:465 TLS | Use a provider-generated app password |
| iCloud | imap.mail.me.com | smtp.mail.me.com:587 STARTTLS | App-specific password required |
| Fastmail | imap.fastmail.com | smtp.fastmail.com:465 TLS | App password recommended |
| GMX | imap.gmx.com | mail.gmx.com:587 STARTTLS | Enable IMAP in account settings |
| Yandex | imap.yandex.com | smtp.yandex.com:465 TLS | App password required |
| Custom | Ask your mail host | Ask your mail host | A custom domain does not identify the provider |

## JSON knowledge folder

The server reloads JSON on each knowledge search, including subfolders. Symlinks
are skipped; files are limited to 1 MB. Arrays or nested objects are accepted.
Only records explicitly marked `active: true` are approved. A record needs its own
`updated` date or a date inherited from its enclosing document. Example:

```json
{
  "updated": "2026-10-07",
  "policies": [
    { "id": "returns", "active": true, "text": "30-day returns on unopened items." }
  ]
}
```

See `skills/mcp-support-si-reply/data/_examples/` for working samples.
Malformed files are reported per record; they are never silently treated as valid.

## Included operations

- IMAP: folder listing/creation, paginated inbox/body search, read without marking
  Seen, Seen/Flagged/Answered flags, atomic moves to folders including Trash.
- POP3: paginated UIDL list and read; leaves mail on the server.
- SMTP: send an exact local draft with proper reply threading and stable Message-ID.
- Local drafts: create, list, inspect, preview; revise by creating another immutable draft.
- Complaints: create, list/filter, inspect, add notes, set priority and status.
- Knowledge: fresh recursive search of approved JSON records, with source and date.
- Status: configuration checks, authentication checks, persistent send outcomes.
- Diagnostics: `diagnose_setup` self-check (no secrets), `connection_status`.

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
| `MCP_SI_MAX_SENDS_PER_HOUR` | Optional send rate cap (0 = unlimited) |
| `MCP_SI_MAX_DRAFTS_PER_HOUR` | Optional draft rate cap (0 = unlimited) |

## Delivery and limits

An exclusive send record prevents sending the same draft twice, even across restarts.
If the connection fails during SMTP, delivery may be unknown: check the provider's
Sent/logs before deciding whether to create a new draft. The plugin does not retry.
SMTP acceptance is not delivery confirmation. Sent-folder copies depend on your
provider; the plugin does not append one. Local drafts do not sync to IMAP Drafts.

Messages over 10 MB are rejected; body text is capped at 60,000 characters.
Attachment metadata is shown; file download, attachment sending, permanent deletion,
POP3 deletion, refund/order APIs, automatic monitoring and unattended replies are
not implemented. Ticket statuses are internal records, not actions in a commerce
system. Run one server process per state folder for ticket edits; send duplicate
protection is cross-process, while case updates assume a single writer.

## Development

```sh
npm ci --ignore-scripts
npm test
```

Tests use temporary directories and fake mail delivery; they send no customer email.
Run connection checks against your provider after supplying credentials.

## License

MIT — see [LICENSE](./LICENSE).
```

---

## 9. `LICENSE`

```
MIT License

Copyright (c) 2026 Susheel HBTI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 10. `CHANGELOG.md`

```markdown
# Changelog

All notable changes are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.0] - 2026-10-08

### Added
- Renamed package to `@susheelhbti/mcp-support-si` and env prefix to `MCP_SI_`.
- `diagnose_setup` tool: non-secret self-check of Node version, env file, required vars, folder access.
- `draft_preview` tool: rendered view of a draft before sending.
- Optional per-hour send and draft rate limits (`MCP_SI_MAX_SENDS_PER_HOUR`, `MCP_SI_MAX_DRAFTS_PER_HOUR`).
- Structured hints on `check_connections` failures (EAUTH, ETIMEDOUT, ENOTFOUND, ESOCKET, ECONNREFUSED).
- Ticket records now link to drafts created for them.
- Example knowledge JSON files under `skills/mcp-support-si-reply/data/_examples/`.
- Additional provider presets: iCloud, Fastmail, GMX, Yandex.
- Optional self-test email in the setup wizard.

### Changed
- `activeRecords` now reports per-record errors instead of discarding an entire file.
- `knowledge_search` returns a hint when no records match.
- Attachment filenames are sanitized (control characters stripped, length capped).
- `Store.put` fsyncs temp files before rename for stronger durability.
- Strict UUID regex in `Store.file`.
- `requireTLS` is now only set for STARTTLS mode (implicit TLS is unaffected).

### Fixed
- `.env.example` filename (was `.env - Copy.example`).
- `draft_create` now requires a subject when not replying to a message.
- `messageId` no longer risks `<uuid@undefined>` on malformed `from` addresses.
- Error whitelist regex no longer leaks arbitrary library errors.

## [2.1.0] - 2026-10-07

### Added
- Initial public structure: IMAP/POP3 read, SMTP send, drafts, tickets, JSON knowledge.

[2.2.0]: https://github.com/susheelhbti/mcp-support-si/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/susheelhbti/mcp-support-si/releases/tag/v2.1.0
```

---

## 11. `SECURITY.md`

```markdown
# Security Policy

## Reporting a vulnerability

Please do **not** open a public issue for security problems. Use GitHub's private
vulnerability reporting on the Security tab, or email the maintainer via the
address on the GitHub profile.

Include:
- Affected version
- Reproduction steps
- Impact assessment
- Any suggested fix

We aim to acknowledge within 72 hours and provide a fix or mitigation plan within
14 days for confirmed issues.

## Scope

In scope:
- Credential exposure
- Injection via headers, MIME, or JSON knowledge files
- Bypass of the send lock or authorization check
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
- Raw library errors are never returned to the model; only whitelisted messages pass through.
```

---

## 12. Test updates

**`test/mcp.test.mjs`** — change the tool-count assertion:

```js
assert.equal(tools.length, 22);
```

**`test/support.test.mjs`** — add two tests:

```js
test('one bad active record does not void the file', async t => {
  const dir = await temp(t);
  await fs.writeFile(path.join(dir, 'mixed.json'), JSON.stringify({ updated: '2026-10-07', records: [
    { active: true, text: 'Good record' },
    { active: true }  // missing updated → per-record error, not file failure
  ]}));
  const r = await knowledge(dir, 'Good');
  assert.equal(r.records.length, 1);
  assert.equal(r.errors.length, 1);
  assert.equal(r.incomplete, true);
});

test('send rate limit blocks excessive sends', async t => {
  const dir = await temp(t);
  const s = new Support({ stateDir: dir, from: 'support@example.com', enableSend: true, maxSendsPerHour: 1 },
    { read: () => parseMessage(raw), send: async () => ({ accepted: ['x@y.z'], rejected: [] }) });
  const d1 = await s.draft({ body: 'one', subject: 'A' });
  await s.send(d1.id, d1.version, true);
  const d2 = await s.draft({ body: 'two', subject: 'B' });
  await assert.rejects(s.send(d2.id, d2.version, true), /rate limit/i);
});
```

Also rename all `NOXR_` occurrences in existing tests to `MCP_SI_`, and update the skill folder references from `noxr-reply` to `mcp-support-si-reply`.

---

## 13. `CONTRIBUTING.md`

```markdown
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
```

---

## 14. `CODE_OF_CONDUCT.md`

```markdown
# Contributor Covenant Code of Conduct

## Our Pledge
We as members, contributors, and leaders pledge to make participation in our
community a harassment-free experience for everyone, regardless of age, body
size, visible or invisible disability, ethnicity, sex characteristics, gender
identity and expression, level of experience, education, socio-economic status,
nationality, personal appearance, race, caste, color, religion, or sexual
identity and orientation.

## Our Standards
Examples of behavior that contributes to a positive environment:
- Demonstrating empathy and kindness
- Being respectful of differing opinions, viewpoints, and experiences
- Giving and gracefully accepting constructive feedback
- Accepting responsibility and apologizing to those affected by mistakes

Examples of unacceptable behavior:
- Sexualized language or imagery
- Trolling, insulting or derogatory comments, personal or political attacks
- Public or private harassment
- Publishing others' private information without permission

## Enforcement
Instances may be reported to the maintainers via the contact on the GitHub
profile. All complaints will be reviewed and investigated promptly and fairly.

## Attribution
This Code of Conduct is adapted from the Contributor Covenant, version 2.1,
available at https://www.contributor-covenant.org/version/2/1/code_of_conduct/
```

---

## 15. `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
        node: [22, 24]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: npm
      - run: npm ci --ignore-scripts
      - run: npm test
```

---

## 16. `.github/ISSUE_TEMPLATE/bug_report.md`

```markdown
---
name: Bug report
about: Report a problem with MCP Support SI
labels: bug
---

**Describe the bug**
A clear description of what went wrong.

**To reproduce**
Steps, including the exact MCP tool call.

**Expected behavior**
What you expected to happen.

**Environment**
- OS:
- Node version (`node --version`):
- Plugin version:
- Provider (Gmail, Outlook, Zoho, custom):
- Protocol (IMAP / POP3 / SMTP):

**Diagnostics**
Output of the `diagnose_setup` tool (contains no secrets).

**Additional context**
Never paste real credentials or customer email content.
```

---

## 17. `.github/ISSUE_TEMPLATE/feature_request.md`

```markdown
---
name: Feature request
about: Suggest an idea for MCP Support SI
labels: enhancement
---

**Problem**
What problem does this solve?

**Proposed solution**
How you imagine it working.

**Alternatives considered**
Other approaches you thought about.

**Additional context**
Screenshots, links, references.
```

---

## 18. Example knowledge files

**`skills/mcp-support-si-reply/data/_examples/policies.example.json`**

```json
{
  "updated": "2026-10-07",
  "policies": [
    {
      "id": "returns",
      "active": true,
      "text": "Unopened items may be returned within 30 days of delivery with proof of purchase. Opened consumables are not eligible for hygiene reasons.",
      "updated": "2026-10-07"
    },
    {
      "id": "shipping",
      "active": true,
      "text": "Standard shipping takes 3–5 business days. Express takes 1–2 business days. Tracking is emailed on dispatch.",
      "updated": "2026-10-07"
    }
  ]
}
```

**`skills/mcp-support-si-reply/data/_examples/faq.example.json`**

```json
{
  "updated": "2026-10-07",
  "faq": [
    {
      "question": "Do you ship internationally?",
      "answer": "Yes. International shipping is available at checkout. Customs duties are the buyer's responsibility.",
      "active": true,
      "updated": "2026-10-07"
    }
  ]
}
```

---

## 🚀 Publish Commands

```sh
# 1. Verify clean state
git status
npm ci --ignore-scripts
npm test

# 2. Scan history for secrets (install gitleaks first)
gitleaks detect --source . --verbose

# 3. Tag and push
git add -A
git commit -m "Release 2.2.0: MCP Support SI, open-source readiness, safety hardening"
git tag v2.2.0
git push origin main --tags

# 4. Publish to npm (2FA enabled on account)
npm publish --access public
```

Because the name is scoped (`@susheelhbti/...`), `--access public` is required on the first publish.

---

## ✅ Final Checklist

- [ ] Folder renamed to `mcp-support-si`
- [ ] All `NOXR_` env vars renamed to `MCP_SI_` in `.env.example`, README, tests
- [ ] Skill folder renamed `skills/noxr-reply/` → `skills/mcp-support-si-reply/`, and `SKILL.md` frontmatter `name:` updated
- [ ] `core.mjs`, `server.mjs`, `setup.mjs`, `package.json`, `plugin.json`, `.codex-plugin/plugin.json`, `mcp.json`, `README.md` replaced
- [ ] `LICENSE`, `CHANGELOG.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` added
- [ ] `.github/workflows/ci.yml` and issue templates added
- [ ] `_examples/` knowledge files added
- [ ] `server.mjs` starts with `#!/usr/bin/env node`
- [ ] `setup.mjs` starts with `#!/usr/bin/env node`
- [ ] `npm test` passes on Node 22 and 24
- [ ] `gitleaks detect` clean
- [ ] Git tag `v2.2.0` pushed
- [ ] `npm publish --access public` succeeds
- [ ] GitHub repo public, topics set (`mcp`, `model-context-protocol`, `email`, `imap`, `smtp`, `customer-support`, `super-intelligent`)

---

## 🧪 Quick Local Smoke Test

After everything is in place:

```sh
# Terminal 1 — start the server manually (optional, for inspection)
node server.mjs

# In your MCP host (Claude Desktop / Codex / Cursor):
# 1. Ask: "Run diagnose_setup"
# 2. Ask: "Run connection_status"
# 3. Ask: "Search knowledge for Sandalwood"
# 4. (After setup) Ask: "Check my IMAP connection"
```

You're ready to ship. Once `npm publish` succeeds, anyone can install with:

```sh
npx @susheelhbti/mcp-support-si
```
