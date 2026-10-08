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
  if (!/^[a-zA-Z0-9.-]+$/.test(value) || value.startsWith('.') || value.endsWith('.')) {
    throw new Error('Enter a mail server hostname, without a URL or port.');
  }
  return value;
}

export function buildSettings(previous, input) {
  const settings = {
    ...previous,
    MCP_SI_MAIL_USER: address(input.email),
    MCP_SI_FROM: address(input.email),
    MCP_SI_MAIL_PASSWORD: input.oauth ? '' : input.secret,
    MCP_SI_ACCESS_TOKEN: input.oauth ? input.secret : '',
    MCP_SI_IMAP_HOST: input.imap ? hostname(input.imap) : '',
    MCP_SI_IMAP_PORT: String(input.imapPort || 993),
    MCP_SI_SMTP_HOST: hostname(input.smtp),
    MCP_SI_SMTP_PORT: String(input.smtpPort),
    MCP_SI_SMTP_SECURITY: input.security,
    MCP_SI_POP3_HOST: input.pop ? hostname(input.pop) : '',
    MCP_SI_POP3_PORT: String(input.popPort || 995),
    MCP_SI_ENABLE_SEND: 'false'
  };
  if (!input.imap && !input.pop) throw new Error('Configure IMAP or POP3 for incoming email.');
  if (input.pop && input.oauth) throw new Error('This plugin supports POP3 password authentication only. Use IMAP with OAuth.');
  config(settings);
  return settings;
}

export function serialize(settings) {
  return '# Private MCP Support SI settings. Never share or commit this file.\n' +
    Object.entries(settings).map(([key, value]) => {
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
  if (Object.keys(parsed).length !== Object.keys(settings).length ||
      Object.entries(settings).some(([key, value]) => parsed[key] !== String(value))) {
    throw new Error('A setting could not be encoded safely');
  }
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, data, { flag: 'wx', mode: 0o600 });
    await fs.rename(temp, file);
  } finally { await fs.unlink(temp).catch(() => {}); }
}

export async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Run npm run setup in your own interactive terminal. Do not send credentials through chat or captured tool input.');
  }
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
    if (preset.oauth) console.log('Microsoft requires OAuth for this setup. This plugin cannot acquire or refresh tokens. Obtain an IMAP/SMTP access token externally, or leave it blank and finish OAuth setup later.');
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
    if ((await ask('Confirm these server addresses before entering a secret? yes/no', 'no')).toLowerCase() !== 'yes') {
      console.log('Cancelled; nothing saved.');
      return;
    }
    process.stdout.write(preset.oauth ? 'OAuth access token (hidden; blank to configure later): ' : 'App password (hidden; blank to configure later): ');
    muted = true;
    let secret;
    try { secret = await rl.question(''); } finally { muted = false; process.stdout.write('\n'); }
    const settings = buildSettings(previous, {
      email,
      imap: imap === '-' ? '' : imap,
      imapPort,
      pop,
      popPort,
      smtp,
      smtpPort,
      security,
      oauth: !!preset.oauth,
      secret
    });
    const dataDir = await ask('JSON knowledge folder (absolute path, or blank for packaged data)', previous.MCP_SI_DATA_DIR || '');
    if (dataDir && !path.isAbsolute(dataDir)) throw new Error('The JSON folder must be an absolute path.');
    settings.MCP_SI_DATA_DIR = dataDir;
    if (dataDir && !(await fs.stat(dataDir)).isDirectory()) throw new Error('The JSON folder is not a directory.');
    console.log(`Save to ${file}. Existing non-mail settings are preserved; sending will be disabled.`);
    if ((await ask('Save settings? yes/no', 'no')).toLowerCase() !== 'yes') {
      console.log('Cancelled; nothing saved.');
      return;
    }
    await saveSettings(file, settings);
    console.log('Saved. Sending is disabled. Restart your MCP host to load these settings.');
    if (secret && (await ask('Test incoming and SMTP login now (sends no email)? yes/no', 'no')).toLowerCase() === 'yes') {
      const mail = new Mail(config(settings));
      try {
        if (settings.MCP_SI_IMAP_HOST) await mail.folders();
        else await mail.popList(0, 1);
        const transport = mail.transport();
        try { await transport.verify(); } finally { transport.close(); }
        console.log('Incoming and SMTP login passed. No email sent.');
      } catch {
        console.log('Login check failed. Confirm provider settings, account permissions and authentication. No email was sent; saved settings remain available to correct.');
      }
    }
    if (secret && (await ask('Send a test email from your account to yourself? yes/no', 'no')).toLowerCase() === 'yes') {
      const mail = new Mail(config(settings));
      const transport = mail.transport();
      try {
        await transport.sendMail({
          from: address(settings.MCP_SI_FROM),
          to: address(settings.MCP_SI_FROM),
          subject: 'MCP Support SI setup test',
          text: 'If you received this, outbound SMTP works.'
        });
        console.log('Test email accepted by SMTP. Check your inbox.');
      } catch {
        console.log('Test email failed. Check SMTP settings and provider sending permissions.');
      } finally {
        transport.close();
      }
    }
  } finally {
    muted = false;
    rl.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Setup could not finish. Check input values, folder permissions and provider settings, then run again. Secrets are not logged.');
    process.exitCode = 1;
  });
}
