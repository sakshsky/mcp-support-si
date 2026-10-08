import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { diagnose } from '../core.mjs';

async function temp(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-si-diag-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('diagnose reports data dir readability and sending state accurately', async t => {
  const dir = await temp(t);
  await fs.mkdir(path.join(dir, 'data'));
  await fs.writeFile(path.join(dir, 'data', 'a.json'), '{}');
  const cfg = {
    user: 'a@b.c', password: 'x', token: '',
    imapHost: 'imap.example.com', smtpHost: 'smtp.example.com',
    dataDir: path.join(dir, 'data'),
    stateDir: path.join(dir, 'state'),
    enableSend: false
  };
  const r = await diagnose(cfg);
  assert.equal(r.nodeVersionOk, Number(process.versions.node.split('.')[0]) >= 22);
  assert.equal(r.dataDir.readable, true);
  assert.equal(r.sendingEnabled, false);
  assert.equal(r.requiredVarsPresent.MCP_SI_MAIL_USER, true);
  assert.equal(r.requiredVarsPresent.MCP_SI_AUTH, true);
  assert.equal(r.requiredVarsPresent.MCP_SI_IMAP_OR_POP3, true);
  assert.equal(r.requiredVarsPresent.MCP_SI_SMTP_HOST, true);
});

test('diagnose reports missing data dir as not readable', async t => {
  const dir = await temp(t);
  const cfg = {
    user: '', password: '', token: '',
    imapHost: '', smtpHost: '',
    dataDir: path.join(dir, 'missing'),
    stateDir: path.join(dir, 'state'),
    enableSend: false
  };
  const r = await diagnose(cfg);
  assert.equal(r.dataDir.readable, false);
  assert.equal(r.requiredVarsPresent.MCP_SI_MAIL_USER, false);
});
