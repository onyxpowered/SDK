// SDK
// Designed & Built By onyxpowered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { createVault } from '../../../../Vault/Vault.js';
import { generateCa, getOrCreateCa, rotateCa, loadCa } from './Ca.js';

function hasOpenssl() {
  try {
    execFileSync('openssl', ['version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function makeVault() {
  const dir = await mkdtemp(join(tmpdir(), 'ship-post-ca-test-'));
  const vault = await createVault({ shipHome: dir, vaultDir: join(dir, 'vault') });
  return { vault, dir };
}

test('generateCa produces a self-signed CA certificate marked CA:true', () => {
  const ca = generateCa('Test CA');
  assert.match(ca.certificatePem, /^-----BEGIN CERTIFICATE-----/);
  assert.match(ca.privateKeyPem, /^-----BEGIN PRIVATE KEY-----/);
});

test('generateCa output is a valid self-signed CA per openssl', { skip: !hasOpenssl() }, () => {
  const ca = generateCa('Test CA');
  const dir = mkdtempSync(join(tmpdir(), 'ship-post-ca-openssl-'));
  const certPath = join(dir, 'ca.pem');
  writeFileSync(certPath, ca.certificatePem);
  const output = execFileSync('openssl', ['verify', '-CAfile', certPath, certPath], { encoding: 'utf8' });
  assert.match(output, /: OK/);
  const text = execFileSync('openssl', ['x509', '-in', certPath, '-noout', '-text'], { encoding: 'utf8' });
  assert.match(text, /CA:TRUE/);
});

test('loadCa returns null when no CA has been persisted yet', async () => {
  const { vault, dir } = await makeVault();
  try {
    const loaded = await loadCa(vault);
    assert.equal(loaded, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getOrCreateCa creates and persists a CA, then reuses it on a second call', async () => {
  const { vault, dir } = await makeVault();
  try {
    const first = await getOrCreateCa(vault);
    assert.ok(first.certificate.ca);
    const second = await getOrCreateCa(vault);
    assert.equal(second.certificatePem, first.certificatePem);
    assert.equal(second.privateKeyPem, first.privateKeyPem);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getOrCreateCa persists through Vault so a fresh Vault handle on the same store sees it', async () => {
  const { vault, dir } = await makeVault();
  try {
    const created = await getOrCreateCa(vault);
    const secondVault = await createVault({ shipHome: dir, vaultDir: join(dir, 'vault') });
    const loaded = await loadCa(secondVault);
    assert.equal(loaded.certificatePem, created.certificatePem);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rotateCa replaces the stored CA with a freshly generated one', async () => {
  const { vault, dir } = await makeVault();
  try {
    const original = await getOrCreateCa(vault);
    const rotated = await rotateCa(vault);
    assert.notEqual(rotated.certificatePem, original.certificatePem);
    const reloaded = await loadCa(vault);
    assert.equal(reloaded.certificatePem, rotated.certificatePem);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
