import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildSettings, serialize, saveSettings, providers } from '../setup.mjs';

const input = {
  email: 'user@example.com',
  imap: 'imap.example.com',
  smtp: 'smtp.example.com',
  smtpPort: '465',
  security: 'tls',
  secret: 'dummy-secret'
};

test('setup replaces old credentials, preserves non-mail keys and disables sending', () => {
  const settings = buildSettings(
    { MCP_SI_ACCESS_TOKEN: 'old-token', MCP_SI_ENABLE_SEND: 'true', MCP_SI_DATA_DIR: 'C:\\approved\\json' },
    input
  );
  assert.equal(settings.MCP_SI_ACCESS_TOKEN, '');
  assert.equal(settings.MCP_SI_ENABLE_SEND, 'false');
  assert.equal(settings.MCP_SI_DATA_DIR, 'C:\\approved\\json');
  const oauth = buildSettings(settings, { ...input, oauth: true, secret: 'new-token' });
  assert.equal(oauth.MCP_SI_MAIL_PASSWORD, '');
  assert.equal(oauth.MCP_SI_ACCESS_TOKEN, 'new-token');
  assert.equal(providers.outlook.smtp, 'smtp-mail.outlook.com');
  assert.equal(providers.microsoft365.oauth, true);
});

test('settings round trip special characters without dotenv injection', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-si-setup-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const settings = buildSettings({}, { ...input, secret: 'fake # $ password with "quotes" and \\slashes' });
  assert.deepEqual(parseEnv(serialize(settings)), settings);
  const file = path.join(dir, '.env');
  await saveSettings(file, settings);
  assert.deepEqual(parseEnv(await fs.readFile(file, 'utf8')), settings);
  await assert.rejects(saveSettings(file, { BAD: 'hello\nMCP_SI_ENABLE_SEND=true' }), /single-line/);
  assert.deepEqual(parseEnv(await fs.readFile(file, 'utf8')), settings);
  await saveSettings(file, { ...settings, MCP_SI_MAIL_PASSWORD: "fake'quote" });
  assert.equal(parseEnv(await fs.readFile(file, 'utf8')).MCP_SI_MAIL_PASSWORD, "fake'quote");
  assert.deepEqual((await fs.readdir(dir)), ['.env']);
});

test('setup rejects bad hosts, unsafe ports, and unsupported POP OAuth', () => {
  assert.throws(() => buildSettings({}, { ...input, smtp: 'https://evil.example.com/path' }));
  assert.throws(() => buildSettings({}, { ...input, smtpPort: '99999' }));
  assert.throws(() => buildSettings({}, { ...input, oauth: true, imap: '', pop: 'pop.example.com' }));
  assert.throws(() => buildSettings({}, { ...input, imap: '', pop: '' }));
});

test('wizard refuses captured/piped input before reading any secrets', () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('../setup.mjs', import.meta.url))],
    { input: 'secret-do-not-print', encoding: 'utf8' }
  );
  assert.equal(result.status, 1);
  assert.equal((result.stdout + result.stderr).includes('secret-do-not-print'), false);
});
