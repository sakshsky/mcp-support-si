import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function makeFixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-si-mcp-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const dataDir = path.join(dir, 'data');
  await fs.mkdir(dataDir);
  await fs.writeFile(path.join(dataDir, 'products.json'), JSON.stringify({
    updated: '2026-10-07',
    products: [{ name: 'Sandalwood Perfume', size: '30 ml', price: '100', active: true }]
  }));
  return { dir, dataDir };
}

test('actual MCP server starts, lists 22 tools, serves knowledge, and blocks sending', async t => {
  const { dir, dataDir } = await makeFixture(t);
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, 'server.mjs')],
    env: {
      ...process.env,
      MCP_SI_ENV_FILE: path.join(dir, 'absent.env'),
      MCP_SI_STATE_DIR: dir,
      MCP_SI_DATA_DIR: dataDir,
      MCP_SI_ENABLE_SEND: 'false',
      MCP_SI_FROM: 'support@example.com'
    },
    stderr: 'pipe'
  });
  const client = new Client({ name: 'mcp-si-test', version: '1.0.0' });
  t.after(async () => { await client.close(); });
  await client.connect(transport);

  const { tools } = await client.listTools();
  assert.equal(tools.length, 22);
  const names = tools.map(t => t.name);
  for (const required of ['connection_status', 'diagnose_setup', 'knowledge_search', 'draft_create', 'draft_preview', 'draft_send', 'send_status', 'ticket_create', 'ticket_update']) {
    assert.ok(names.includes(required), `missing tool ${required}`);
  }
  assert.ok(tools.find(t => t.name === 'draft_send').annotations.destructiveHint);
  assert.ok(tools.find(t => t.name === 'mail_move').annotations.destructiveHint);

  const call = async (name, args = {}) => client.callTool({ name, arguments: args });

  const status = JSON.parse((await call('connection_status')).content[0].text);
  assert.equal(status.sendingEnabled, false);

  const diag = JSON.parse((await call('diagnose_setup')).content[0].text);
  assert.equal(diag.sendingEnabled, false);
  assert.equal(diag.nodeVersionOk, true);

  const k = JSON.parse((await call('knowledge_search', { query: 'Sandalwood' })).content[0].text);
  assert.equal(k.records[0].record.name, 'Sandalwood Perfume');

  const draft = JSON.parse((await call('draft_create', { to: 'customer@example.com', subject: 'Test', body: 'Draft only' })).content[0].text);
  const preview = JSON.parse((await call('draft_preview', { id: draft.id })).content[0].text);
  assert.equal(preview.body, 'Draft only');
  assert.equal(preview.from, 'support@example.com');

  const send = await call('draft_send', { id: draft.id, version: draft.version, authorized: true });
  assert.equal(send.isError, true);
  assert.match(send.content[0].text, /disabled/);
});

test('five read-only tools accept representative inputs without schema errors', async t => {
  const { dir, dataDir } = await makeFixture(t);
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, 'server.mjs')],
    env: {
      ...process.env,
      MCP_SI_ENV_FILE: path.join(dir, 'absent.env'),
      MCP_SI_STATE_DIR: dir,
      MCP_SI_DATA_DIR: dataDir,
      MCP_SI_ENABLE_SEND: 'false',
      MCP_SI_FROM: 'support@example.com'
    },
    stderr: 'pipe'
  });
  const client = new Client({ name: 'mcp-si-schema', version: '1.0.0' });
  t.after(async () => { await client.close(); });
  await client.connect(transport);

  for (const [name, args] of [
    ['connection_status', {}],
    ['diagnose_setup', {}],
    ['knowledge_search', { query: '', limit: 10 }],
    ['draft_list', { offset: 0, limit: 5 }],
    ['ticket_list', { offset: 0, limit: 5 }]
  ]) {
    const r = await client.callTool({ name, arguments: args });
    assert.ok(r.content?.[0]?.text, `${name} returned no content`);
    if (r.isError) {
      assert.doesNotMatch(r.content[0].text, /schema|validation/i, `${name} failed schema validation: ${r.content[0].text}`);
    }
  }
});
