import test from 'node:test';
import assert from 'node:assert/strict';
import { safeError, AppError } from '../core.mjs';

test('AppError messages pass through unchanged', () => {
  assert.equal(safeError(new AppError('Sending disabled; set MCP_SI_ENABLE_SEND=true locally', { code: 'SEND_DISABLED' })),
    'Sending disabled; set MCP_SI_ENABLE_SEND=true locally');
  assert.equal(safeError(new AppError('Draft version mismatch; review the current draft', { code: 'VERSION_MISMATCH' })),
    'Draft version mismatch; review the current draft');
  assert.equal(safeError(new AppError('Folder not found: Missing. Use mail_folders to list available folders.', { code: 'FOLDER_NOT_FOUND' })),
    'Folder not found: Missing. Use mail_folders to list available folders.');
});

test('raw library errors are masked; only allowlisted codes are shown', () => {
  const raw = new Error('Login failed for user a@b.c password=hunter2');
  raw.code = 'EAUTH';
  const masked = safeError(raw);
  assert.doesNotMatch(masked, /hunter2/);
  assert.doesNotMatch(masked, /a@b\.c/);
  assert.match(masked, /EAUTH/);
  assert.match(masked, /Operation failed/);
});

test('unknown library codes are masked to UNKNOWN', () => {
  const raw = new Error('weird internal');
  raw.code = 'SOMETHING_ELSE';
  const masked = safeError(raw);
  assert.doesNotMatch(masked, /weird internal/);
  assert.match(masked, /UNKNOWN/);
});

test('errors without a code are masked', () => {
  const masked = safeError(new Error('some internal detail'));
  assert.doesNotMatch(masked, /internal detail/);
  assert.match(masked, /UNKNOWN/);
});
