import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Support } from '../core.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coreHref = pathToFileURL(path.join(root, 'core.mjs')).href;

async function runChild(script, payload, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      return reject(new Error(`child spawn failed: ${e.code || e.message}`));
    }
    let out = '', err = '';
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(arg);
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      finish(reject, new Error(`child timeout after ${timeoutMs}ms; stdout=${out} stderr=${err}`));
    }, timeoutMs);
    child.on('error', e => finish(reject, new Error(`child error: ${e.code || e.message}`)));
    child.stdout.on('data', c => out += c);
    child.stderr.on('data', c => err += c);
    child.on('close', code => {
      if (code !== 0 && !out.trim()) return finish(reject, new Error(`child exited ${code}: ${err}`));
      const line = out.trim().split('\n').pop();
      try { finish(resolve, JSON.parse(line)); }
      catch (e) { finish(reject, new Error(`child output unparseable: ${out} / ${err}`)); }
    });
    child.stdin.on('error', () => { /* ignore EPIPE */ });
    child.stdin.end(JSON.stringify(payload));
  });
}

const sendScript = `
  import { Support, parseMessage } from ${JSON.stringify(coreHref)};
  let input = ''; process.stdin.on('data', d => input += d);
  process.stdin.on('end', async () => {
    const job = JSON.parse(input);
    const raw = Buffer.from('From: C <c@example.com>\\r\\nTo: s@example.com\\r\\nSubject: T\\r\\nMessage-ID: <o@e>\\r\\n\\r\\nB');
    let attempts = 0;
    const mail = {
      read: () => parseMessage(raw),
      send: async () => { attempts++; await new Promise(r => setTimeout(r, 40)); return { accepted: ['c@example.com'], rejected: [] }; }
    };
    const s = new Support(job.cfg, mail);
    try {
      const r = await s.send(job.draftId, job.version, true);
      console.log(JSON.stringify({ ok: true, r, attempts }));
    } catch (e) {
      console.log(JSON.stringify({ ok: false, message: e.message, code: e.code, attempts }));
    }
  });
`;

const ticketScript = `
  import { Support } from ${JSON.stringify(coreHref)};
  let input = ''; process.stdin.on('data', d => input += d);
  process.stdin.on('end', async () => {
    const job = JSON.parse(input);
    const s = new Support(job.cfg, {});
    try {
      const r = await s.ticketUpdate({ id: job.id, expectedUpdated: job.expectedUpdated, status: job.status });
      console.log(JSON.stringify({ ok: true, updated: r.updated, status: r.status }));
    } catch (e) { console.log(JSON.stringify({ ok: false, message: e.message })); }
  });
`;

async function prepareDraft(cfg, to) {
  const s = new Support(cfg, { send: async () => ({}) });
  return s.draft({ to, subject: 'S', body: 'B' });
}

test('separate processes cannot exceed the send budget', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-si-xproc-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const cfg = { stateDir: dir, from: 'support@example.com', enableSend: true, maxSendsPerHour: 1 };
  const d1 = await prepareDraft(cfg, 'a@example.com');
  const d2 = await prepareDraft(cfg, 'b@example.com');
  const d3 = await prepareDraft(cfg, 'c@example.com');

  const results = await Promise.all([
    runChild(sendScript, { cfg, draftId: d1.id, version: d1.version }),
    runChild(sendScript, { cfg, draftId: d2.id, version: d2.version }),
    runChild(sendScript, { cfg, draftId: d3.id, version: d3.version })
  ]);

  const acceptedBySmtp = results.filter(r => r.ok && r.r.status === 'accepted_by_smtp' && !r.r.duplicatePrevented).length;
  const blocked = results.filter(r => !r.ok && /rate limit/i.test(r.message)).length;
  const totalAttempts = results.reduce((n, r) => n + (r.attempts || 0), 0);

  assert.equal(acceptedBySmtp, 1, `exactly one send should reach SMTP, got ${JSON.stringify(results)}`);
  assert.equal(blocked, 2);
  assert.equal(totalAttempts, 1, 'independent SMTP attempt counter must equal 1');
});

test('separate processes cannot duplicate-send the same draft', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-si-xproc-dup-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const cfg = { stateDir: dir, from: 'support@example.com', enableSend: true };
  const d = await prepareDraft(cfg, 'customer@example.com');

  const results = await Promise.all([
    runChild(sendScript, { cfg, draftId: d.id, version: d.version }),
    runChild(sendScript, { cfg, draftId: d.id, version: d.version })
  ]);

  const acceptedBySmtp = results.filter(r => r.ok && r.r.status === 'accepted_by_smtp' && !r.r.duplicatePrevented).length;
  const dup = results.filter(r => r.ok && r.r.duplicatePrevented).length;
  const totalAttempts = results.reduce((n, r) => n + (r.attempts || 0), 0);

  assert.equal(acceptedBySmtp, 1, JSON.stringify(results));
  assert.equal(dup, 1, JSON.stringify(results));
  assert.equal(totalAttempts, 1, 'exactly one SMTP attempt across both processes');
});

test('separate processes cannot lose a ticket update', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-si-xproc-ticket-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const cfg = { stateDir: dir, from: 'support@example.com' };
  const s = new Support(cfg, {});
  const c = await s.ticketCreate({ customer: 'customer@example.com', subject: 'X', summary: 'Y' });

  const results = await Promise.all([
    runChild(ticketScript, { cfg, id: c.id, expectedUpdated: c.updated, status: 'in_progress' }),
    runChild(ticketScript, { cfg, id: c.id, expectedUpdated: c.updated, status: 'resolved' })
  ]);

  const wins = results.filter(r => r.ok).length;
  const conflicts = results.filter(r => !r.ok && /changed; reload/i.test(r.message)).length;
  assert.equal(wins, 1);
  assert.equal(conflicts, 1);
});
