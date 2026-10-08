import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Support, parseMessage } from '../core.mjs';

async function temp(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-si-limits-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
const raw = Buffer.from(
  'From: Customer <customer@example.com>\r\nTo: support@example.com\r\n' +
  'Subject: Test\r\nMessage-ID: <orig@example.com>\r\n\r\nBody'
);

test('draft rate limit blocks excessive drafts', async t => {
  const dir = await temp(t);
  const s = new Support(
    { stateDir: dir, from: 'support@example.com', enableSend: true, maxDraftsPerHour: 1 },
    { read: () => parseMessage(raw), send: async () => ({ accepted: ['customer@example.com'], rejected: [] }) }
  );
  await s.draft({ to: 'a@example.com', subject: 'A', body: 'one' });
  await assert.rejects(s.draft({ to: 'b@example.com', subject: 'B', body: 'two' }), /Draft rate limit/i);
});

test('draft rate limit 0 means unlimited', async t => {
  const dir = await temp(t);
  const s = new Support(
    { stateDir: dir, from: 'support@example.com', enableSend: true, maxDraftsPerHour: 0 },
    { read: () => parseMessage(raw), send: async () => ({ accepted: ['customer@example.com'], rejected: [] }) }
  );
  for (let i = 0; i < 5; i++) await s.draft({ to: 'a@example.com', subject: `S${i}`, body: `b${i}` });
  assert.equal((await s.store.list('drafts')).length, 5);
});

test('send rate limit blocks excessive sends', async t => {
  const dir = await temp(t);
  const s = new Support(
    { stateDir: dir, from: 'support@example.com', enableSend: true, maxSendsPerHour: 1 },
    { read: () => parseMessage(raw), send: async () => ({ accepted: ['customer@example.com'], rejected: [] }) }
  );
  const d1 = await s.draft({ to: 'a@example.com', subject: 'A', body: 'one' });
  await s.send(d1.id, d1.version, true);
  const d2 = await s.draft({ to: 'b@example.com', subject: 'B', body: 'two' });
  await assert.rejects(s.send(d2.id, d2.version, true), /rate limit/i);
});

test('retrying a reserved draft returns its record even when the budget is full', async t => {
  const dir = await temp(t);
  let sends = 0;
  const s = new Support(
    { stateDir: dir, from: 'support@example.com', enableSend: true, maxSendsPerHour: 1 },
    { read: () => parseMessage(raw), send: async () => { sends++; return { accepted: ['c@example.com'], rejected: [] }; } }
  );
  const d = await s.draft({ to: 'customer@example.com', subject: 'X', body: 'body' });
  await s.send(d.id, d.version, true);
  const again = await s.send(d.id, d.version, true);
  assert.equal(again.duplicatePrevented, true);
  assert.equal(again.status, 'accepted_by_smtp');
  assert.equal(sends, 1);
});

test('SMTP rejection leaves a durable record and blocks retry', async t => {
  const dir = await temp(t);
  const s = new Support(
    { stateDir: dir, from: 'support@example.com', enableSend: true },
    { read: () => parseMessage(raw), send: async () => ({ accepted: [], rejected: ['customer@example.com'] }) }
  );
  const d = await s.draft({ to: 'customer@example.com', subject: 'X', body: 'body' });
  const r = await s.send(d.id, d.version, true);
  assert.equal(r.status, 'rejected');
  const again = await s.send(d.id, d.version, true);
  assert.equal(again.duplicatePrevented, true);
});

test('SMTP timeout yields delivery_unknown and blocks retry', async t => {
  const dir = await temp(t);
  const s = new Support(
    { stateDir: dir, from: 'support@example.com', enableSend: true },
    { read: () => parseMessage(raw), send: async () => { const e = new Error('socket timeout'); e.code = 'ETIMEDOUT'; throw e; } }
  );
  const d = await s.draft({ to: 'customer@example.com', subject: 'X', body: 'body' });
  assert.equal((await s.send(d.id, d.version, true)).status, 'delivery_unknown');
  assert.equal((await s.send(d.id, d.version, true)).duplicatePrevented, true);
});

test('sending disabled by default', async t => {
  const dir = await temp(t);
  const s = new Support(
    { stateDir: dir, from: 'support@example.com' },
    { read: () => parseMessage(raw), send: async () => ({ accepted: ['customer@example.com'], rejected: [] }) }
  );
  const d = await s.draft({ to: 'customer@example.com', subject: 'X', body: 'body' });
  await assert.rejects(s.send(d.id, d.version, true), /disabled/);
});

test('authorization absent blocks send', async t => {
  const dir = await temp(t);
  const s = new Support(
    { stateDir: dir, from: 'support@example.com', enableSend: true },
    { read: () => parseMessage(raw), send: async () => ({ accepted: ['customer@example.com'], rejected: [] }) }
  );
  const d = await s.draft({ to: 'customer@example.com', subject: 'X', body: 'body' });
  await assert.rejects(s.send(d.id, d.version, false), /authorization/);
});

test('changed draft content invalidates the reviewed version', async t => {
  const dir = await temp(t);
  const s = new Support(
    { stateDir: dir, from: 'support@example.com', enableSend: true },
    { read: () => parseMessage(raw), send: async () => ({ accepted: ['customer@example.com'], rejected: [] }) }
  );
  const d = await s.draft({ to: 'customer@example.com', subject: 'X', body: 'body' });
  const stored = await s.store.get('drafts', d.id);
  stored.body = 'tampered';
  await s.store.put('drafts', stored);
  await assert.rejects(s.send(d.id, d.version, true), /Draft content changed/);
});

test('changed sender identity invalidates the reviewed draft', async t => {
  const dir = await temp(t);
  const s = new Support(
    { stateDir: dir, from: 'support@example.com', enableSend: true },
    { read: () => parseMessage(raw), send: async () => ({ accepted: ['customer@example.com'], rejected: [] }) }
  );
  const d = await s.draft({ to: 'customer@example.com', subject: 'X', body: 'body' });
  s.cfg.from = 'other@example.com';
  await assert.rejects(s.send(d.id, d.version, true), /Sender identity changed/);
});

test('send budget fails closed when a reservation record is corrupt', async t => {
  const dir = await temp(t);
  const s = new Support(
    { stateDir: dir, from: 'support@example.com', enableSend: true, maxSendsPerHour: 5 },
    { read: () => parseMessage(raw), send: async () => ({ accepted: ['customer@example.com'], rejected: [] }) }
  );
  const d = await s.draft({ to: 'customer@example.com', subject: 'X', body: 'body' });
  const sendsDir = path.join(dir, 'sends');
  await fs.mkdir(sendsDir, { recursive: true });
  await fs.writeFile(path.join(sendsDir, 'ffffffff-ffff-ffff-ffff-ffffffffffff.json'), '{not json');
  await assert.rejects(s.send(d.id, d.version, true), /Cannot scan sends/);
});

test('send budget fails closed when a reservation has an impossible timestamp', async t => {
  const dir = await temp(t);
  const s = new Support(
    { stateDir: dir, from: 'support@example.com', enableSend: true, maxSendsPerHour: 5 },
    { read: () => parseMessage(raw), send: async () => ({ accepted: ['customer@example.com'], rejected: [] }) }
  );
  const d = await s.draft({ to: 'customer@example.com', subject: 'X', body: 'body' });
  const sendsDir = path.join(dir, 'sends');
  await fs.mkdir(sendsDir, { recursive: true });
  await fs.writeFile(
    path.join(sendsDir, 'ffffffff-ffff-ffff-ffff-ffffffffffff.json'),
    JSON.stringify({ id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', reservedAt: '2026-02-30T00:00:00.000Z', updated: '2026-10-08T00:00:00.000Z' })
  );
  await assert.rejects(s.send(d.id, d.version, true), /failed validation/);
});

test('send budget fails closed when a reservation has a non-ISO timestamp', async t => {
  const dir = await temp(t);
  const s = new Support(
    { stateDir: dir, from: 'support@example.com', enableSend: true, maxSendsPerHour: 5 },
    { read: () => parseMessage(raw), send: async () => ({ accepted: ['customer@example.com'], rejected: [] }) }
  );
  const d = await s.draft({ to: 'customer@example.com', subject: 'X', body: 'body' });
  const sendsDir = path.join(dir, 'sends');
  await fs.mkdir(sendsDir, { recursive: true });
  await fs.writeFile(
    path.join(sendsDir, 'ffffffff-ffff-ffff-ffff-ffffffffffff.json'),
    JSON.stringify({ id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', reservedAt: 'not a date', updated: '2026-10-08T00:00:00.000Z' })
  );
  await assert.rejects(s.send(d.id, d.version, true), /failed validation/);
});

test('send budget fails closed when a reservation id mismatches the filename', async t => {
  const dir = await temp(t);
  const s = new Support(
    { stateDir: dir, from: 'support@example.com', enableSend: true, maxSendsPerHour: 5 },
    { read: () => parseMessage(raw), send: async () => ({ accepted: ['customer@example.com'], rejected: [] }) }
  );
  const d = await s.draft({ to: 'customer@example.com', subject: 'X', body: 'body' });
  const sendsDir = path.join(dir, 'sends');
  await fs.mkdir(sendsDir, { recursive: true });
  await fs.writeFile(
    path.join(sendsDir, 'ffffffff-ffff-ffff-ffff-ffffffffffff.json'),
    JSON.stringify({ id: '00000000-0000-0000-0000-000000000000', reservedAt: '2026-10-08T00:00:00.000Z', updated: '2026-10-08T00:00:00.000Z' })
  );
  await assert.rejects(s.send(d.id, d.version, true), /missing or mismatched id/);
});

test('draft budget fails closed when a draft record is corrupt', async t => {
  const dir = await temp(t);
  const s = new Support(
    { stateDir: dir, from: 'support@example.com', enableSend: true, maxDraftsPerHour: 5 },
    { send: async () => ({}) }
  );
  const draftsDir = path.join(dir, 'drafts');
  await fs.mkdir(draftsDir, { recursive: true });
  await fs.writeFile(path.join(draftsDir, 'ffffffff-ffff-ffff-ffff-ffffffffffff.json'), '{not json');
  await assert.rejects(s.draft({ to: 'a@example.com', subject: 'A', body: 'x' }), /Cannot scan drafts/);
});

test('draft budget fails closed when a draft has an impossible timestamp', async t => {
  const dir = await temp(t);
  const s = new Support(
    { stateDir: dir, from: 'support@example.com', enableSend: true, maxDraftsPerHour: 5 },
    { send: async () => ({}) }
  );
  const draftsDir = path.join(dir, 'drafts');
  await fs.mkdir(draftsDir, { recursive: true });
  await fs.writeFile(
    path.join(draftsDir, 'ffffffff-ffff-ffff-ffff-ffffffffffff.json'),
    JSON.stringify({ id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', updated: '2026-02-30T00:00:00.000Z' })
  );
  await assert.rejects(s.draft({ to: 'a@example.com', subject: 'A', body: 'x' }), /failed validation/);
});

test('lenient listing skips structurally invalid records without throwing', async t => {
  const dir = await temp(t);
  const s = new Support({ stateDir: dir, from: 'support@example.com' }, {});
  const draftsDir = path.join(dir, 'drafts');
  await fs.mkdir(draftsDir, { recursive: true });
  await fs.writeFile(
    path.join(draftsDir, 'ffffffff-ffff-ffff-ffff-ffffffffffff.json'),
    JSON.stringify({ id: 'ffffffff-ffff-ffff-ffff-ffffffffffff' })
  );
  const rows = await s.store.list('drafts');
  assert.equal(rows.length, 0);
  assert.equal(rows.skipped.length, 1);
  assert.match(rows.skipped[0].error, /missing_or_invalid_updated/);
});

test('draft is preserved with a warning when ticket linking fails', async t => {
  const dir = await temp(t);
  const s = new Support(
    { stateDir: dir, from: 'support@example.com', enableSend: true },
    { send: async () => ({}) }
  );
  const c = await s.ticketCreate({ customer: 'customer@example.com', subject: 'X', summary: 'Y' });
  const originalWithTicketLock = s._withTicketLock.bind(s);
  s._withTicketLock = async (id, fn) => {
    if (id === c.id) throw new Error('simulated link failure');
    return originalWithTicketLock(id, fn);
  };
  const d = await s.draft({ to: 'customer@example.com', subject: 'Reply', body: 'body', ticketId: c.id });
  assert.ok(d.id, 'draft must still be returned');
  assert.match(d.warning || '', /ticket link failed/i);
  assert.doesNotMatch(d.warning, /simulated link failure/);
  const stored = await s.store.get('drafts', d.id);
  assert.equal(stored.id, d.id);
});
