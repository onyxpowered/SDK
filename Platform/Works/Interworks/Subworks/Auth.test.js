// SDK
// Designed & Built By onyxpowered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVault } from '../../../Vault/Vault.js';
import {
  getDaemonToken,
  setDaemonToken,
  clearDaemonToken,
  requireDaemonToken,
  hasDaemonToken,
  authorizationHeader,
} from './Auth.js';

async function makeVault() {
  const dir = await mkdtemp(join(tmpdir(), 'ship-interworks-auth-test-'));
  const vault = await createVault({ shipHome: dir, vaultDir: join(dir, 'vault') });
  return { vault, dir };
}

test('getDaemonToken returns null before any token has been stored', async () => {
  const { vault, dir } = await makeVault();
  try {
    assert.equal(await getDaemonToken(vault), null);
    assert.equal(await hasDaemonToken(vault), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('setDaemonToken rejects an empty or non-string token', async () => {
  const { vault, dir } = await makeVault();
  try {
    await assert.rejects(() => setDaemonToken(vault, ''), /non-empty string/);
    await assert.rejects(() => setDaemonToken(vault, null), /non-empty string/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('setDaemonToken persists the token and getDaemonToken reads it back', async () => {
  const { vault, dir } = await makeVault();
  try {
    await setDaemonToken(vault, 'ship_tok_abc123', { accountId: 'acct_1' });
    const record = await getDaemonToken(vault);
    assert.equal(record.token, 'ship_tok_abc123');
    assert.equal(record.accountId, 'acct_1');
    assert.equal(typeof record.issuedAt, 'string');
    assert.equal(await hasDaemonToken(vault), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('requireDaemonToken throws a clear "run ship login" error when unset', async () => {
  const { vault, dir } = await makeVault();
  try {
    await assert.rejects(() => requireDaemonToken(vault), /sdk login/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('requireDaemonToken returns the bare token string once set', async () => {
  const { vault, dir } = await makeVault();
  try {
    await setDaemonToken(vault, 'ship_tok_xyz789');
    assert.equal(await requireDaemonToken(vault), 'ship_tok_xyz789');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('clearDaemonToken removes the stored token so requireDaemonToken throws again', async () => {
  const { vault, dir } = await makeVault();
  try {
    await setDaemonToken(vault, 'ship_tok_temp');
    await clearDaemonToken(vault);
    assert.equal(await hasDaemonToken(vault), false);
    await assert.rejects(() => requireDaemonToken(vault));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('persists through Vault so a fresh Vault handle on the same store sees the token', async () => {
  const { vault, dir } = await makeVault();
  try {
    await setDaemonToken(vault, 'ship_tok_persisted');
    const secondVault = await createVault({ shipHome: dir, vaultDir: join(dir, 'vault') });
    assert.equal(await requireDaemonToken(secondVault), 'ship_tok_persisted');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('authorizationHeader formats a bearer header', () => {
  assert.equal(authorizationHeader('abc'), 'Bearer abc');
});
