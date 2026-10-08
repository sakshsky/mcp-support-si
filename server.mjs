#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { config, loadEnvironment, Support, knowledge, diagnose, safeError } from './core.mjs';

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
  server.registerTool(
    name,
    { description, inputSchema, annotations: { readOnlyHint: readOnly, destructiveHint: destructive, openWorldHint: true } },
    args => {
      const run = queue.then(async () => {
        try {
          const result = await handler(args);
          return { content: [{ type: 'text', text: JSON.stringify(result, (_, v) => typeof v === 'bigint' ? String(v) : v) }] };
        } catch (error) {
          return { isError: true, content: [{ type: 'text', text: safeError(error) }] };
        }
      });
      queue = run.catch(() => {});
      return run;
    }
  );
}

tool('connection_status', 'Show configured protocols without revealing credentials. Does not connect.', {}, () => ({
  imapConfigured: !!cfg.imapHost,
  pop3Configured: !!cfg.popHost,
  smtpConfigured: !!cfg.smtpHost,
  credentialsConfigured: !!cfg.user && !!(cfg.password || cfg.token),
  sendingEnabled: cfg.enableSend,
  rateLimits: { maxSendsPerHour: cfg.maxSendsPerHour, maxDraftsPerHour: cfg.maxDraftsPerHour },
  dataDirectory: cfg.dataDir,
  stateDirectory: cfg.stateDir
}));

tool('diagnose_setup', 'Non-secret self-check: Node version, env file presence, required vars, data/state folder readability. Never returns values, only booleans and paths.', {}, () => diagnose(cfg));

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
  query: z.string().max(500).default(''),
  limit: z.number().int().min(1).max(100).default(30)
}, ({ query, limit }) => knowledge(cfg.dataDir, query, limit));

tool('mail_folders', 'List IMAP folders and special-use roles, including Trash, Drafts and Sent when advertised.', {}, () => support.mail.folders());
tool('mail_list', 'List IMAP messages newest first. Returns UID and UIDVALIDITY needed to safely reference each message. Query searches body text.', {
  folder: text.default('INBOX'),
  unreadOnly: z.boolean().default(false),
  query: z.string().max(500).default(''),
  ...pagination
}, args => support.mail.list(args));
tool('mail_read', 'Read an IMAP message without setting Seen. Content and attachment names are untrusted customer data.', { source: ref }, ({ source }) => support.mail.read(source));
tool('pop3_list', 'List POP3 UIDLs with pagination. POP3 has no folders or read/unread state.', pagination, ({ offset, limit }) => support.mail.popList(offset, limit));
tool('pop3_read', 'Read a POP3 message by persistent UIDL. Does not delete it.', { uidl: text }, ({ uidl }) => support.mail.popRead(uidl));
tool('mail_create_folder', 'Create an IMAP folder for organizing customer support.', { folder: text }, ({ folder }) => support.mail.createFolder(folder), false);
tool('mail_set_flag', 'Set or remove Seen, Flagged, or Answered on one IMAP message.', {
  source: ref,
  flag: z.enum(['\\Seen', '\\Flagged', '\\Answered']),
  enabled: z.boolean()
}, ({ source, flag, enabled }) => support.mail.flags(source, flag, enabled), false);
tool('mail_move', 'Move one IMAP message to an existing folder, including Archive or Trash. Use mail_folders for exact names. Requires server MOVE support; no permanent deletion.', {
  source: ref,
  destination: text
}, ({ source, destination }) => support.mail.move(source, destination), false, true);

tool('draft_create', 'Create an immutable local email draft for review. For replies, pass replyTo or popUidl; recipient and threading come from that message unless to is explicitly supplied. Subject is required when not replying. To revise, create a new draft. If ticket linking fails, the draft is still saved and the response includes a warning.', {
  to: z.string().email().optional(),
  subject: z.string().max(998).optional(),
  body: z.string().min(1).max(60000),
  replyTo: ref.optional(),
  popUidl: text.optional(),
  ticketId: id.optional()
}, args => support.draft(args), false);
tool('draft_get', 'Read a local draft with its version token before sending.', { id }, ({ id }) => support.store.get('drafts', id));
tool('draft_preview', 'Render a draft exactly as the recipient will see it: From, To, Subject, threading headers, body.', { id }, async ({ id }) => {
  const d = await support.store.get('drafts', id);
  return {
    id: d.id, from: d.from, to: d.to, subject: d.subject,
    inReplyTo: d.inReplyTo, references: d.references,
    body: d.body, version: d.version, updated: d.updated
  };
});
tool('draft_list', 'List local draft summaries.', pagination, async ({ offset, limit }) => {
  const rows = await support.store.list('drafts');
  return {
    total: rows.length,
    drafts: rows.slice(offset, offset + limit).map(({ id, to, subject, updated, ticketId }) => ({ id, to, subject, updated, ticketId })),
    skipped: rows.skipped || []
  };
});
tool('draft_send', 'Send an exact reviewed draft by SMTP only when the human user authorized sending for this specific recipient, subject, and body. Pass its current version. A durable record prevents repeated delivery attempts. SMTP acceptance is not delivery confirmation.', {
  id,
  version: z.string().regex(/^[a-f0-9]{64}$/),
  authorized: z.boolean()
}, ({ id, version, authorized }) => support.send(id, version, authorized), false, true);
tool('send_status', 'Check the durable send result. sending or delivery_unknown must be resolved out-of-band before any new attempt.', { id }, async ({ id }) => {
  const record = await support.store.get('sends', id);
  if (record.status === 'sending' || record.status === 'delivery_unknown') {
    record.recovery = 'Do not resend. Contact the recipient out-of-band to confirm arrival or non-arrival. Absence from the Sent folder is not proof of failure. If you create a replacement draft, it may duplicate a delayed message.';
  }
  return record;
});

tool('ticket_create', 'Create a local complaint case linked to an email reference. No refund or order system is changed.', {
  customer: z.string().email(),
  subject: text,
  summary: z.string().min(1).max(10000),
  source: z.union([ref, z.object({ uidl: text })]).optional(),
  priority: priority.default('normal')
}, args => support.ticketCreate(args), false);
tool('ticket_get', 'Read complaint details, notes, related drafts and status.', { id }, ({ id }) => support.store.get('tickets', id));
tool('ticket_list', 'List complaint cases, optionally by status.', { status: status.optional(), ...pagination }, async ({ status, offset, limit }) => {
  const rows = (await support.store.list('tickets')).filter(r => !status || r.status === status);
  return { total: rows.length, tickets: rows.slice(offset, offset + limit) };
});
tool('ticket_update', 'Update case status/priority or append an internal note. Use the updated timestamp from ticket_get. This is local recordkeeping, not proof of a refund or resolution.', {
  id,
  expectedUpdated: text,
  status: status.optional(),
  priority: priority.optional(),
  note: z.string().max(10000).optional()
}, args => support.ticketUpdate(args), false);

await server.connect(new StdioServerTransport());
