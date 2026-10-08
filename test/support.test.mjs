import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { config, header, address, parseMessage, Support, Mail } from '../core.mjs';

async function temp(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-si-support-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

const raw = Buffer.from(
  'From: Customer <customer@example.com>\r\n' +
  'Reply-To: help@example.net\r\n' +
  'To: support@example.com\r\n' +
  'Subject: =?UTF-8?Q?Broken_perfume?=\r\n' +
  'Message-ID: <original@example.com>\r\n' +
  'Content-Type: text/plain; charset=utf-8\r\n' +
  '\r\n' +
  'My bottle arrived broken.'
);

test('header injection and insecure SMTP mode rejected', () => {
  assert.throws(() => header('ok\r\nBcc: evil@example.com'));
  assert.throws(() => address('a@example.com,b@example.com'));
  assert.throws(() => config({ MCP_SI_SMTP_SECURITY: 'none' }));
});

test('MIME parser returns decoded body and reply address', async () => {
  const result = await parseMessage(raw);
  assert.equal(result.subject, 'Broken perfume');
  assert.equal(result.replyTo[0].address, 'help@example.net');
  assert.equal(result.messageId, '<original@example.com>');
  assert.equal(result.untrustedContent, true);
});

test('draft requires subject when not replying', async t => {
  const dir = await temp(t);
  const s = new Support({ stateDir: dir, from: 'support@example.com' }, { send: async () => ({}) });
  await assert.rejects(s.draft({ to: 'customer@example.com', body: 'x' }), /Subject required/);
});

test('draft requires a recipient', async t => {
  const dir = await temp(t);
  const s = new Support({ stateDir: dir, from: 'support@example.com' }, { send: async () => ({}) });
  await assert.rejects(s.draft({ subject: 'x', body: 'y' }), /Missing recipient/);
});

test('draft from replyTo sets recipient, sender, and threading', async t => {
  const dir = await temp(t);
  const s = new Support(
    { stateDir: dir, from: 'support@example.com' },
    { read: () => parseMessage(raw), send: async () => ({}) }
  );
  const d = await s.draft({ body: 'Please share your order number.', replyTo: { folder: 'INBOX', uid: 1, uidValidity: '9' } });
  assert.equal(d.to, 'help@example.net');
  assert.equal(d.inReplyTo, '<original@example.com>');
  assert.equal(d.from, 'support@example.com');
});

test('ticket stale updates fail and successful updates persist', async t => {
  const s = new Support({ stateDir: await temp(t), from: 'support@example.com' });
  const c = await s.ticketCreate({ customer: 'customer@example.com', subject: 'Broken', summary: 'Bottle broken' });
  await assert.rejects(s.ticketUpdate({ id: c.id, expectedUpdated: 'old', status: 'closed' }), /changed/);
  const changed = await s.ticketUpdate({ id: c.id, expectedUpdated: c.updated, status: 'waiting_customer', note: 'Requested order number' });
  assert.equal(changed.status, 'waiting_customer');
  assert.equal(changed.notes.length, 1);
  await assert.rejects(s.store.get('tickets', '../escape'), /Invalid/);
});

test('IMAP checks UIDVALIDITY, uses UID fetch, enforces size, and closes locks', async () => {
  let released = 0, loggedOut = 0, requestedSource = false;
  const client = {
    on() {},
    connect: async () => {},
    logout: async () => { loggedOut++; },
    mailbox: { uidValidity: 123n },
    getMailboxLock: async () => ({ release: () => { released++; } }),
    fetchOne: async (uid, query, options) => {
      assert.equal(uid, 12);
      assert.equal(options.uid, true);
      if (query.source) { requestedSource = true; return { source: raw }; }
      return { size: 200 };
    }
  };
  const mail = new Mail(
    { imapHost: 'example.com', user: 'a@example.com', password: 'secret' },
    { imap: options => { assert.equal(options.secure, true); return client; } }
  );
  await assert.rejects(mail.read({ folder: 'INBOX', uid: 12, uidValidity: '999' }), /UIDVALIDITY/);
  assert.equal(requestedSource, false);
  assert.equal((await mail.read({ folder: 'INBOX', uid: 12, uidValidity: '123' })).subject, 'Broken perfume');
  assert.equal(released, 2);
  assert.equal(loggedOut, 2);
  client.fetchOne = async () => ({ size: 11 * 1024 * 1024 });
  await assert.rejects(mail.read({ folder: 'INBOX', uid: 12, uidValidity: '123' }), /10 MB/);
});

test('IMAP folder-not-found is translated on list()', async () => {
  const client = {
    on() {}, connect: async () => {}, logout: async () => {},
    mailbox: { uidValidity: 1n },
    getMailboxLock: async () => { throw new Error('Mailbox does not exist'); },
    fetchOne: async () => null
  };
  const mail = new Mail(
    { imapHost: 'example.com', user: 'a@example.com', password: 'secret' },
    { imap: () => client }
  );
  await assert.rejects(mail.list({ folder: 'Missing' }), /Folder not found: Missing/);
});

test('IMAP non-folder errors pass through unchanged', async () => {
  const client = {
    on() {}, connect: async () => {}, logout: async () => {},
    mailbox: { uidValidity: 1n },
    getMailboxLock: async () => { throw new Error('Authentication failed'); },
    fetchOne: async () => null
  };
  const mail = new Mail(
    { imapHost: 'example.com', user: 'a@example.com', password: 'secret' },
    { imap: () => client }
  );
  await assert.rejects(mail.list({ folder: 'INBOX' }), /Authentication failed/);
});

test('POP3 re-resolves UIDL and requires verified TLS', async () => {
  let quit = 0;
  const mail = new Mail(
    { popHost: 'example.com', user: 'a@example.com', password: 'secret' },
    {
      pop: options => {
        assert.equal(options.tls, true);
        assert.equal(options.tlsOptions.rejectUnauthorized, true);
        return {
          UIDL: async () => [['7', 'stable-id']],
          RETR: async n => { assert.equal(n, '7'); return raw; },
          QUIT: async () => { quit++; }
        };
      }
    }
  );
  assert.equal((await mail.popRead('stable-id')).subject, 'Broken perfume');
  await assert.rejects(mail.popRead('deleted-id'), /not found/);
  assert.equal(quit, 2);
});

test('SMTP transport sends with draft.from, not mutable config', async () => {
  let closed = false;
  const mail = new Mail(
    { smtpHost: 'example.com', user: 'a@example.com', password: 'secret', from: 'other@example.com', security: 'starttls', smtpPort: 587 },
    {
      smtp: options => {
        assert.equal(options.requireTLS, true);
        assert.equal(options.secure, false);
        return {
          sendMail: async message => {
            assert.equal(message.from, 'support@example.com');
            assert.equal(message.text, 'Hello');
            return { accepted: [message.to] };
          },
          close: () => { closed = true; }
        };
      }
    }
  );
  await mail.send({ from: 'support@example.com', to: 'b@example.com', body: 'Hello' });
  assert.equal(closed, true);
});

test('implicit TLS transport does not set requireTLS', async () => {
  const mail = new Mail(
    { smtpHost: 'example.com', user: 'a@example.com', password: 'secret', from: 'a@example.com', security: 'tls', smtpPort: 465 },
    { smtp: options => { assert.equal(options.requireTLS, false); assert.equal(options.secure, true); return { sendMail: async () => ({ accepted: [] }), close: () => {} }; } }
  );
  await mail.send({ from: 'a@example.com', to: 'b@example.com', body: 'x' });
});
