import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import Pop3Command from 'node-pop3';
import { simpleParser } from 'mailparser';

const root = path.dirname(fileURLToPath(import.meta.url));
const base = path.join(os.homedir(), '.mcp-support-si');

// --- Application errors ---------------------------------------------------
export class AppError extends Error {
  constructor(message, { code = 'APP_ERROR', cause } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

const SAFE_LIBRARY_CODES = new Set([
  'EAUTH', 'ETIMEDOUT', 'ENOTFOUND', 'ESOCKET', 'ECONNREFUSED', 'ECONNRESET',
  'EEXIST', 'ENOENT', 'EACCES', 'EPERM'
]);

export function safeError(error) {
  if (error instanceof AppError) return error.message;
  const code = error && SAFE_LIBRARY_CODES.has(error.code) ? error.code : 'UNKNOWN';
  return `Operation failed (${code}). Check configuration or server availability.`;
}

// --- Validation helpers --------------------------------------------------
// A valid timestamp is one whose round trip through Date is a no-op. This
// rejects impossible dates such as 2026-02-30 (which Date normalizes to
// March 2) and non-ISO strings. Records written by the plugin use
// Date#toISOString(), so exact round trip is the correct invariant.
export function isValidIsoTimestamp(value) {
  if (typeof value !== 'string' || value.length < 20) return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value)) return false;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return false;
  try { return new Date(t).toISOString() === value; }
  catch { return false; }
}

// Accepts a knowledge-record date of the form YYYY-MM-DD and validates the
// calendar date by round trip.
export function isValidKnowledgeDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// --- Config --------------------------------------------------------------
export function config(env = process.env) {
  const port = (name, fallback) => {
    const value = Number(env[name] || fallback);
    if (!Number.isInteger(value) || value < 1 || value > 65535) throw new AppError(`Invalid ${name}`, { code: 'INVALID_CONFIG' });
    return value;
  };
  const security = env.MCP_SI_SMTP_SECURITY || 'tls';
  if (!['tls', 'starttls'].includes(security)) throw new AppError('SMTP security must be tls or starttls', { code: 'INVALID_CONFIG' });
  const nonNegInt = (name, fallback = 0) => {
    const v = Number(env[name] ?? fallback);
    if (!Number.isInteger(v) || v < 0) throw new AppError(`Invalid ${name}`, { code: 'INVALID_CONFIG' });
    return v;
  };
  return {
    user: env.MCP_SI_MAIL_USER,
    password: env.MCP_SI_MAIL_PASSWORD,
    token: env.MCP_SI_ACCESS_TOKEN,
    from: env.MCP_SI_FROM || env.MCP_SI_MAIL_USER,
    imapHost: env.MCP_SI_IMAP_HOST,
    imapPort: port('MCP_SI_IMAP_PORT', 993),
    smtpHost: env.MCP_SI_SMTP_HOST,
    smtpPort: port('MCP_SI_SMTP_PORT', 465),
    security,
    popHost: env.MCP_SI_POP3_HOST,
    popPort: port('MCP_SI_POP3_PORT', 995),
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

// --- Input validation ----------------------------------------------------
export function header(value) {
  if (typeof value !== 'string' || /[\r\n\0]/.test(value)) throw new AppError('Invalid header or protocol value', { code: 'INVALID_INPUT' });
  return value;
}

export function address(value) {
  header(value);
  if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(value)) throw new AppError('Use one plain email address', { code: 'INVALID_INPUT' });
  return value;
}

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const now = () => new Date().toISOString();
const MAX_MESSAGE = 10 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCK_TIMEOUT_MS = 5000;
const LOCK_RETRY_MS = 25;

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// --- Cross-process lock --------------------------------------------------
async function withLock(lockPath, fn) {
  const start = Date.now();
  let handle;
  while (true) {
    try {
      handle = await fs.open(lockPath, 'wx', 0o600);
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (Date.now() - start > LOCK_TIMEOUT_MS) {
        throw new AppError(
          `Lock timeout at ${lockPath}. Another process may be holding it. ` +
          `Confirm the owning process has stopped, then delete this file manually and retry.`,
          { code: 'LOCK_TIMEOUT' }
        );
      }
      await delay(LOCK_RETRY_MS);
    }
  }
  try { return await fn(); }
  finally {
    await handle.close().catch(() => {});
    await fs.unlink(lockPath).catch(() => {});
  }
}

// --- Store ---------------------------------------------------------------
export class Store {
  constructor(dir) { this.dir = dir; }
  file(kind, id) {
    if (!['drafts', 'tickets', 'sends'].includes(kind) || !UUID_RE.test(id)) {
      throw new AppError('Invalid record ID', { code: 'INVALID_ID' });
    }
    return path.join(this.dir, kind, `${id}.json`);
  }
  async put(kind, record, exclusive = false) {
    const file = this.file(kind, record.id);
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    if (exclusive) {
      const fh = await fs.open(file, 'wx', 0o600);
      try {
        await fh.writeFile(JSON.stringify(record, null, 2));
        await fh.sync();
      } finally { await fh.close(); }
    } else {
      const temp = `${file}.${randomUUID()}.tmp`;
      const fh = await fs.open(temp, 'w', 0o600);
      try {
        await fh.writeFile(JSON.stringify(record, null, 2));
        await fh.sync();
      } finally { await fh.close(); }
      await fs.rename(temp, file);
    }
    if (process.platform !== 'win32') {
      // Best-effort: directory fsync is not supported on every filesystem.
      try {
        const dh = await fs.open(path.dirname(file), 'r');
        try { await dh.sync(); } finally { await dh.close(); }
      } catch { /* ignore */ }
    }
    return record;
  }
  async get(kind, id) { return JSON.parse(await fs.readFile(this.file(kind, id), 'utf8')); }

  // Lenient listing for tools. Records that are unreadable, malformed, not a
  // plain object, missing a string `id`, whose `id` does not match the file
  // name, or missing a string `updated` field are skipped and reported on the
  // returned array as a non-enumerable `skipped` property.
  async list(kind) {
    const folder = path.join(this.dir, kind);
    let files;
    try { files = await fs.readdir(folder); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    const rows = [], skipped = [];
    for (const file of files.filter(f => f.endsWith('.json'))) {
      const id = file.slice(0, -5);
      let record;
      try { record = await this.get(kind, id); }
      catch (e) { skipped.push({ file, error: e.code || 'parse_error' }); continue; }
      if (!isPlainObject(record)) { skipped.push({ file, error: 'not_an_object' }); continue; }
      if (typeof record.id !== 'string') { skipped.push({ file, error: 'missing_id' }); continue; }
      if (record.id !== id) { skipped.push({ file, error: 'id_mismatch' }); continue; }
      if (typeof record.updated !== 'string') { skipped.push({ file, error: 'missing_or_invalid_updated' }); continue; }
      rows.push(record);
    }
    rows.sort((a, b) => b.updated.localeCompare(a.updated));
    Object.defineProperty(rows, 'skipped', { value: skipped, enumerable: false });
    return rows;
  }

  // Strict listing for budget scans. Any unreadable, malformed, or invalid
  // record causes the whole scan to fail closed. Extra sends are blocked
  // rather than permitted. Damaged records must be investigated in place;
  // removing them removes their protection.
  async listStrict(kind, { requireFields = [], validate } = {}) {
    const folder = path.join(this.dir, kind);
    let files;
    try { files = await fs.readdir(folder); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    const rows = [];
    for (const file of files.filter(f => f.endsWith('.json'))) {
      const id = file.slice(0, -5);
      let record;
      try { record = await this.get(kind, id); }
      catch (e) {
        throw new AppError(
          `Cannot scan ${kind}: record ${file} is unreadable or malformed (${e.code || 'parse_error'}). ` +
          `Investigate stateDir/${kind}/${file} without removing it; the reservation is protecting against duplicate sends.`,
          { code: 'STORE_SCAN_FAILED', cause: e }
        );
      }
      if (!isPlainObject(record)) {
        throw new AppError(
          `Cannot scan ${kind}: record ${file} is not an object. Investigate stateDir/${kind}/${file} without removing it.`,
          { code: 'STORE_SCAN_FAILED' }
        );
      }
      if (typeof record.id !== 'string' || record.id !== id) {
        throw new AppError(
          `Cannot scan ${kind}: record ${file} has a missing or mismatched id. Investigate stateDir/${kind}/${file} without removing it.`,
          { code: 'STORE_SCAN_FAILED' }
        );
      }
      for (const field of requireFields) {
        if (record[field] === undefined || record[field] === null) {
          throw new AppError(
            `Cannot scan ${kind}: record ${file} is missing field "${field}". ` +
            `Investigate stateDir/${kind}/${file} without removing it.`,
            { code: 'STORE_SCAN_FAILED' }
          );
        }
      }
      if (validate) {
        const problem = validate(record);
        if (problem) {
          throw new AppError(
            `Cannot scan ${kind}: record ${file} failed validation (${problem}). ` +
            `Investigate stateDir/${kind}/${file} without removing it.`,
            { code: 'STORE_SCAN_FAILED' }
          );
        }
      }
      rows.push(record);
    }
    return rows;
  }
}

// --- Knowledge -----------------------------------------------------------
export function activeRecords(value, inheritedDate, trail = '') {
  const records = [], errors = [];
  const walk = (v, date, loc) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach((item, i) => walk(item, date, `${loc}/${i}`)); return; }
    if (v.active === false) return;
    const updated = v.updated || date;
    if (v.active === true) {
      if (!isValidKnowledgeDate(updated)) {
        errors.push({ location: loc, error: 'Active record missing or invalid updated date' });
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
  let boundary;
  try { boundary = await fs.realpath(dir); }
  catch (e) { return { records: [], total: 0, errors: [{ file: dir, error: `Data directory not accessible: ${e.code || e.message}` }], incomplete: true }; }

  async function visit(folder, relBase = '') {
    let entries;
    try { entries = await fs.readdir(folder, { withFileTypes: true }); }
    catch (e) {
      errors.push({ file: relBase || '.', error: `Cannot read directory: ${e.code || e.message}` });
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.name.startsWith('_')) continue;
      const file = path.join(folder, entry.name);
      const relative = path.join(relBase, entry.name);
      let real;
      try { real = await fs.realpath(file); }
      catch (e) { errors.push({ file: relative, error: `Cannot resolve: ${e.code || e.message}` }); continue; }
      if (!real.startsWith(boundary + path.sep)) continue;

      if (entry.isDirectory()) {
        await visit(file, relative);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          if ((await fs.stat(file)).size > 1024 * 1024) throw new AppError('JSON exceeds 1 MB', { code: 'FILE_TOO_LARGE' });
          const parsed = activeRecords(JSON.parse(await fs.readFile(file, 'utf8')));
          records.push(...parsed.records.map(r => ({ file: relative, ...r })));
          errors.push(...parsed.errors.map(e => ({ file: relative, ...e })));
        } catch (e) {
          errors.push({ file: relative, error: e instanceof AppError ? e.message : `Cannot read or parse: ${e.code || 'invalid JSON'}` });
        }
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

// --- Message parsing -----------------------------------------------------
export async function parseMessage(raw) {
  if (Buffer.byteLength(raw) > MAX_MESSAGE) throw new AppError('Message exceeds 10 MB', { code: 'MESSAGE_TOO_LARGE' });
  const parsed = await simpleParser(raw, { skipHtmlToText: false, skipTextToHtml: true });
  const safeName = n => (n || '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 255);
  return {
    messageId: parsed.messageId,
    references: parsed.references,
    from: parsed.from?.value || [],
    to: parsed.to?.value || [],
    replyTo: parsed.replyTo?.value || [],
    subject: parsed.subject || '',
    date: parsed.date?.toISOString(),
    text: (parsed.text || '').slice(0, 60000),
    truncated: (parsed.text || '').length > 60000,
    attachments: parsed.attachments.map((a, i) => ({ index: i, name: safeName(a.filename), type: a.contentType, size: a.size })),
    untrustedContent: true
  };
}

// --- Mail transport ------------------------------------------------------
export class Mail {
  constructor(cfg, factories = {}) {
    this.cfg = cfg;
    this.factories = {
      imap: options => new ImapFlow(options),
      pop: options => new Pop3Command(options),
      smtp: options => nodemailer.createTransport(options),
      ...factories
    };
  }
  credentials() {
    const c = this.cfg;
    if (!c.user || (!c.password && !c.token)) throw new AppError('Configure mail username and password or access token locally', { code: 'MISSING_CREDENTIALS' });
    header(c.user);
    return c.token ? { user: c.user, accessToken: c.token } : { user: c.user, pass: c.password };
  }
  async imap(folder, action, validity) {
    const c = this.cfg;
    if (!c.imapHost) throw new AppError('Configure MCP_SI_IMAP_HOST', { code: 'MISSING_CONFIG' });
    const client = this.factories.imap({
      host: c.imapHost, port: c.imapPort, secure: true,
      auth: this.credentials(), logger: false,
      connectionTimeout: 15000, socketTimeout: 30000
    });
    client.on('error', () => {});
    try {
      await client.connect();
      if (!folder) return await action(client);
      let lock;
      try {
        lock = await client.getMailboxLock(header(folder));
      } catch (e) {
        const msg = String(e?.responseText || e?.message || '');
        if (/NONEXISTENT|does not exist|Mailbox not found|No such mailbox|Unknown mailbox/i.test(msg)) {
          throw new AppError(`Folder not found: ${folder}. Use mail_folders to list available folders.`, { code: 'FOLDER_NOT_FOUND', cause: e });
        }
        throw e;
      }
      try {
        if (validity && String(client.mailbox.uidValidity) !== validity) {
          throw new AppError('Mailbox UIDVALIDITY changed; list messages again', { code: 'UIDVALIDITY_CHANGED' });
        }
        return await action(client);
      } finally { lock.release(); }
    } finally {
      await client.logout().catch(() => client.close());
    }
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
      if (!meta) throw new AppError('Message no longer exists', { code: 'MESSAGE_GONE' });
      if (meta.size > MAX_MESSAGE) throw new AppError('Message exceeds 10 MB', { code: 'MESSAGE_TOO_LARGE' });
      const m = await client.fetchOne(ref.uid, { source: true }, { uid: true });
      if (!m?.source) throw new AppError('Message no longer exists', { code: 'MESSAGE_GONE' });
      return m.source;
    }, ref.uidValidity);
  }
  async read(ref) { return { ...ref, ...await parseMessage(await this.raw(ref)) }; }
  async folders() { return this.imap(null, async c => (await c.list()).map(f => ({ path: f.path, specialUse: f.specialUse }))); }
  async createFolder(folder) { return this.imap(null, c => c.mailboxCreate(header(folder))); }
  async flags(ref, flag, enabled) {
    return this.imap(ref.folder, async c => {
      if (!await c.fetchOne(ref.uid, { uid: true }, { uid: true })) throw new AppError('Message not found', { code: 'MESSAGE_GONE' });
      return enabled ? c.messageFlagsAdd(ref.uid, [flag], { uid: true }) : c.messageFlagsRemove(ref.uid, [flag], { uid: true });
    }, ref.uidValidity);
  }
  async move(ref, destination) {
    return this.imap(ref.folder, async c => {
      if (!c.capabilities.has('MOVE')) throw new AppError('Server lacks atomic MOVE; no messages changed', { code: 'MOVE_UNSUPPORTED' });
      if (!await c.fetchOne(ref.uid, { uid: true }, { uid: true })) throw new AppError('Message not found', { code: 'MESSAGE_GONE' });
      const result = await c.messageMove(ref.uid, header(destination), { uid: true });
      if (!result) throw new AppError('Move failed', { code: 'MOVE_FAILED' });
      return { moved: true, destination, uidValidity: String(result.uidValidity || ''), uidMap: result.uidMap ? [...result.uidMap] : [] };
    }, ref.uidValidity);
  }
  async pop(action) {
    const c = this.cfg;
    if (!c.popHost || !c.user || !c.password) throw new AppError('Configure POP3 host, username and password', { code: 'MISSING_CONFIG' });
    header(c.user); header(c.password);
    const client = this.factories.pop({
      host: c.popHost, port: c.popPort, user: c.user, password: c.password,
      tls: true, tlsOptions: { rejectUnauthorized: true },
      timeout: 20000, streamReadTimeout: 30000, maxMailSize: MAX_MESSAGE
    });
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
      if (!row) throw new AppError('POP3 message not found', { code: 'MESSAGE_GONE' });
      return { uidl, ...await parseMessage(await c.RETR(row[0])) };
    });
  }
  transport() {
    const c = this.cfg;
    if (!c.smtpHost) throw new AppError('Configure MCP_SI_SMTP_HOST', { code: 'MISSING_CONFIG' });
    const auth = this.credentials();
    return this.factories.smtp({
      host: c.smtpHost, port: c.smtpPort,
      secure: c.security === 'tls',
      requireTLS: c.security === 'starttls',
      auth: c.token ? { type: 'OAuth2', ...auth } : auth,
      connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
      disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false
    });
  }
  async send(draft) {
    const transport = this.transport();
    try {
      return await transport.sendMail({
        from: address(draft.from),
        to: draft.to,
        subject: draft.subject,
        text: draft.body,
        messageId: draft.messageId,
        inReplyTo: draft.inReplyTo,
        references: draft.references
      });
    } finally { transport.close(); }
  }
}

// --- Support workflows ---------------------------------------------------
export class Support {
  constructor(cfg, mail = new Mail(cfg)) {
    this.cfg = cfg;
    this.mail = mail;
    this.store = new Store(cfg.stateDir);
  }

  async _withDraftBudgetLock(fn) {
    const lockPath = path.join(this.cfg.stateDir, 'locks', 'drafts-budget.lock');
    await fs.mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
    return withLock(lockPath, async () => {
      const limit = this.cfg.maxDraftsPerHour || 0;
      if (limit) {
        const strict = await this.store.listStrict('drafts', {
          requireFields: ['updated'],
          validate: r => isValidIsoTimestamp(r.updated) ? null : `invalid updated "${r.updated}"`
        });
        const recent = strict.filter(r => Date.parse(r.updated) >= Date.now() - 3600_000).length;
        if (recent >= limit) throw new AppError(`Draft rate limit reached (${limit}/hour). Wait before creating another draft.`, { code: 'DRAFT_RATE_LIMIT' });
      }
      return fn();
    });
  }

  // Acquires the send-budget lock ONLY. The callback orders duplicate check →
  // budget count → reservation creation, so retrying a reserved draft returns
  // its record even when the hour's budget is full.
  async _withSendBudgetLock(fn) {
    const lockPath = path.join(this.cfg.stateDir, 'locks', 'send-budget.lock');
    await fs.mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
    return withLock(lockPath, fn);
  }

  async _enforceSendBudgetLocked() {
    const limit = this.cfg.maxSendsPerHour || 0;
    if (!limit) return;
    const strict = await this.store.listStrict('sends', {
      requireFields: ['reservedAt'],
      validate: r => isValidIsoTimestamp(r.reservedAt) ? null : `invalid reservedAt "${r.reservedAt}"`
    });
    const recent = strict.filter(r => Date.parse(r.reservedAt) >= Date.now() - 3600_000).length;
    if (recent >= limit) throw new AppError(`Sending rate limit reached (${limit}/hour). Wait before sending.`, { code: 'SEND_RATE_LIMIT' });
  }

  async _withTicketLock(id, fn) {
    const lockPath = path.join(this.cfg.stateDir, 'locks', `ticket-${id}.lock`);
    await fs.mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
    return withLock(lockPath, fn);
  }

  async draft({ to, subject, body, replyTo, popUidl, ticketId }) {
    if (replyTo && popUidl) throw new AppError('Choose one source message', { code: 'INVALID_INPUT' });
    let source;
    if (replyTo) source = await this.mail.read(replyTo);
    if (popUidl) source = await this.mail.popRead(popUidl);
    const target = to || source?.replyTo?.[0]?.address || source?.from?.[0]?.address;
    if (!target) throw new AppError('Missing recipient: supply to=, replyTo=, or popUidl=', { code: 'MISSING_RECIPIENT' });
    if (!source && !subject) throw new AppError('Subject required when not replying to a message', { code: 'MISSING_SUBJECT' });
    if (ticketId) await this.store.get('tickets', ticketId);
    const fromAddress = address(this.cfg.from);

    return this._withDraftBudgetLock(async () => {
      const id = randomUUID();
      const record = {
        id,
        to: address(target),
        from: fromAddress,
        subject: header(subject || (source ? `Re: ${source.subject.replace(/^Re:\s*/i, '')}` : '')),
        body,
        ticketId,
        replyTo,
        popUidl,
        inReplyTo: source?.messageId,
        references: source ? [...(Array.isArray(source.references) ? source.references : source.references ? [source.references] : []), source.messageId].filter(Boolean) : [],
        messageId: `<${id}@${fromAddress.split('@')[1]}>`,
        updated: now()
      };
      record.version = digest(record);
      await this.store.put('drafts', record, true);

      // Ticket linking is best-effort. The draft is already durable; a link
      // failure must not cause the caller to think creation failed.
      if (ticketId) {
        try {
          await this._withTicketLock(ticketId, async () => {
            const ticket = await this.store.get('tickets', ticketId);
            ticket.drafts = [...(ticket.drafts || []), { id, subject: record.subject, updated: record.updated }];
            ticket.updated = new Date(Math.max(Date.now(), Date.parse(ticket.updated) + 1)).toISOString();
            await this.store.put('tickets', ticket);
          });
        } catch (e) {
          record.warning = `Draft saved, but ticket link failed: ${safeError(e)}. Ticket ${ticketId} may need manual update.`;
        }
      }
      return record;
    });
  }

  async send(id, version, authorized) {
    if (!this.cfg.enableSend) throw new AppError('Sending disabled; set MCP_SI_ENABLE_SEND=true locally', { code: 'SEND_DISABLED' });
    if (!authorized) throw new AppError('Sending requires user authorization for this draft', { code: 'NOT_AUTHORIZED' });
    const draft = await this.store.get('drafts', id);
    if (draft.version !== version) throw new AppError('Draft version mismatch; review the current draft', { code: 'VERSION_MISMATCH' });
    const { version: _v, ...reviewable } = draft;
    if (digest(reviewable) !== version) throw new AppError('Draft content changed since review; create a new draft and re-approve', { code: 'CONTENT_CHANGED' });
    if (address(this.cfg.from) !== draft.from) throw new AppError('Sender identity changed since review; create a new draft and re-approve', { code: 'SENDER_CHANGED' });

    let reservation;
    await this._withSendBudgetLock(async () => {
      // Step 1: duplicate check (returns existing reservation if present).
      let existing;
      try { existing = await this.store.get('sends', id); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (existing) { reservation = { ...existing, duplicatePrevented: true }; return; }

      // Step 2: budget count (fails closed on corrupt or invalid records).
      await this._enforceSendBudgetLocked();

      // Step 3: reservation.
      const record = { id, reservedAt: now(), updated: now(), status: 'sending', messageId: draft.messageId };
      try {
        await this.store.put('sends', record, true);
      } catch (e) {
        if (e.code === 'EEXIST') {
          reservation = { ...await this.store.get('sends', id), duplicatePrevented: true };
          return;
        }
        throw e;
      }
      reservation = record;
    });

    if (reservation?.duplicatePrevented) return reservation;
    if (!reservation) throw new AppError('Send reservation failed unexpectedly', { code: 'RESERVATION_FAILED' });

    try {
      const result = await this.mail.send(draft);
      reservation.status = result.accepted?.length ? 'accepted_by_smtp' : 'rejected';
      reservation.accepted = result.accepted;
      reservation.rejected = result.rejected;
    } catch {
      reservation.status = 'delivery_unknown';
      reservation.nextStep = 'Delivery status uncertain. Do not resend without contacting the recipient out-of-band.';
    }
    reservation.updated = now();
    await this.store.put('sends', reservation);
    return reservation;
  }

  async ticketCreate({ customer, subject, summary, source, priority = 'normal' }) {
    return this.store.put('tickets', {
      id: randomUUID(),
      customer: address(customer),
      subject,
      summary,
      source,
      priority,
      status: 'open',
      notes: [],
      drafts: [],
      created: now(),
      updated: now()
    }, true);
  }

  async ticketUpdate({ id, status, priority, note, expectedUpdated }) {
    return this._withTicketLock(id, async () => {
      const record = await this.store.get('tickets', id);
      if (expectedUpdated !== record.updated) throw new AppError('Ticket changed; reload it first', { code: 'TICKET_CONFLICT' });
      if (status) record.status = status;
      if (priority) record.priority = priority;
      if (note) record.notes.push({ date: now(), text: note });
      record.updated = new Date(Math.max(Date.now(), Date.parse(record.updated) + 1)).toISOString();
      return this.store.put('tickets', record);
    });
  }
}

// --- Diagnostics ---------------------------------------------------------
export async function diagnose(cfg) {
  const envFile = process.env.MCP_SI_ENV_FILE || path.join(base, '.env');
  const exists = p => { try { fsSync.accessSync(p, fsSync.constants.R_OK); return true; } catch { return false; } };
  const writable = p => { try { fsSync.accessSync(p, fsSync.constants.W_OK); return true; } catch { return false; } };
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
}
