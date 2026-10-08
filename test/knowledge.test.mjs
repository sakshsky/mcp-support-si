import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { knowledge, activeRecords, isValidIsoTimestamp, isValidKnowledgeDate } from '../core.mjs';

async function temp(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-si-know-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('isValidKnowledgeDate rejects impossible dates', () => {
  assert.equal(isValidKnowledgeDate('2026-10-07'), true);
  assert.equal(isValidKnowledgeDate('2026-02-30'), false);
  assert.equal(isValidKnowledgeDate('2026-13-01'), false);
  assert.equal(isValidKnowledgeDate('not-a-date'), false);
  assert.equal(isValidKnowledgeDate(20261007), false);
});

test('isValidIsoTimestamp requires exact round trip', () => {
  const real = new Date().toISOString();
  assert.equal(isValidIsoTimestamp(real), true);
  assert.equal(isValidIsoTimestamp('2026-02-30T00:00:00.000Z'), false);
  assert.equal(isValidIsoTimestamp('2026-13-01T00:00:00.000Z'), false);
  assert.equal(isValidIsoTimestamp('2026-10-08'), false);
  assert.equal(isValidIsoTimestamp(1775692800000), false);
  assert.equal(isValidIsoTimestamp('not-a-date'), false);
});

test('activeRecords returns per-record errors', () => {
  const { records, errors } = activeRecords({
    records: [
      { active: true, text: 'ok', updated: '2026-10-07' },
      { active: true, text: 'no date' }
    ]
  });
  assert.equal(records.length, 1);
  assert.equal(errors.length, 1);
});

test('activeRecords rejects invalid calendar dates', () => {
  const { records, errors } = activeRecords({
    records: [{ active: true, text: 'bad', updated: '2026-13-45' }]
  });
  assert.equal(records.length, 0);
  assert.equal(errors.length, 1);
});

test('example data under _examples is excluded from live knowledge', async t => {
  const dir = await temp(t);
  await fs.mkdir(path.join(dir, '_examples'));
  await fs.writeFile(path.join(dir, '_examples', 'policies.json'),
    JSON.stringify({ updated: '2026-10-07', policies: [{ active: true, text: 'FAKE' }] }));
  await fs.writeFile(path.join(dir, 'real.json'),
    JSON.stringify({ updated: '2026-10-07', policies: [{ active: true, text: 'REAL' }] }));
  const r = await knowledge(dir, '');
  assert.equal(r.records.length, 1);
  assert.match(JSON.stringify(r), /REAL/);
  assert.doesNotMatch(JSON.stringify(r), /FAKE/);
});

test('approved-record filtering honors inherited and own dates', async t => {
  const dir = await temp(t);
  await fs.writeFile(path.join(dir, 'a.json'), JSON.stringify({
    updated: '2026-10-01',
    policies: [
      { active: true, text: 'inherited' },
      { active: true, text: 'own', updated: '2026-10-05' },
      { active: false, text: 'hidden' }
    ]
  }));
  const r = await knowledge(dir, '');
  assert.equal(r.records.length, 2);
  assert.equal(r.records.find(x => /inherited/.test(x.record.text)).updated, '2026-10-01');
  assert.equal(r.records.find(x => /own/.test(x.record.text)).updated, '2026-10-05');
});

test('malformed JSON does not prevent valid siblings from loading', async t => {
  const dir = await temp(t);
  await fs.writeFile(path.join(dir, 'bad.json'), '{');
  await fs.writeFile(path.join(dir, 'good.json'),
    JSON.stringify({ updated: '2026-10-07', policies: [{ active: true, text: 'OK' }] }));
  const r = await knowledge(dir, '');
  assert.equal(r.records.length, 1);
  assert.equal(r.incomplete, true);
  assert.match(JSON.stringify(r), /OK/);
});

test('inaccessible JSON is reported without discarding others', async t => {
  if (process.platform === 'win32') { t.skip('chmod read denial unreliable on Windows'); return; }
  if (typeof process.getuid === 'function' && process.getuid() === 0) { t.skip('running as root; chmod does not deny read'); return; }
  const dir = await temp(t);
  await fs.writeFile(path.join(dir, 'good.json'),
    JSON.stringify({ updated: '2026-10-07', policies: [{ active: true, text: 'OK' }] }));
  const badPath = path.join(dir, 'bad.json');
  await fs.writeFile(badPath, '{}');
  await fs.chmod(badPath, 0o000);
  try {
    const r = await knowledge(dir, '');
    assert.equal(r.records.length, 1);
    assert.equal(r.incomplete, true);
    assert.ok(r.errors.some(e => e.file === 'bad.json'));
  } finally {
    await fs.chmod(badPath, 0o600).catch(() => {});
  }
});

test('unreadable subfolder does not abort the whole search', async t => {
  if (process.platform === 'win32') { t.skip('chmod directory denial unreliable on Windows'); return; }
  if (typeof process.getuid === 'function' && process.getuid() === 0) { t.skip('running as root'); return; }
  const dir = await temp(t);
  await fs.writeFile(path.join(dir, 'good.json'),
    JSON.stringify({ updated: '2026-10-07', policies: [{ active: true, text: 'OK' }] }));
  const bad = path.join(dir, 'locked');
  await fs.mkdir(bad);
  await fs.writeFile(path.join(bad, 'x.json'),
    JSON.stringify({ updated: '2026-10-07', policies: [{ active: true, text: 'HIDDEN' }] }));
  await fs.chmod(bad, 0o000);
  try {
    const r = await knowledge(dir, '');
    assert.equal(r.records.length, 1);
    assert.match(JSON.stringify(r), /OK/);
    assert.doesNotMatch(JSON.stringify(r), /HIDDEN/);
    assert.equal(r.incomplete, true);
  } finally {
    await fs.chmod(bad, 0o700).catch(() => {});
  }
});
