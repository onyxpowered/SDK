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
import { getOrCreateCa, rotateCa } from './Ca.js';
import { generateLeafCertificate, getOrCreateLeafCertificate, loadLeafCertificate, DEFAULT_LEAF_HOSTNAMES } from './Leaf.js';

function hasOpenssl() {
  try {
    execFileSync('openssl', ['version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function makeVault() {
  const dir = await mkdtemp(join(tmpdir(), 'ship-post-leaf-test-'));
  const vault = await createVault({ shipHome: dir, vaultDir: join(dir, 'vault') });
  return { vault, dir };
}

test('generateLeafCertificate issues a certificate covering the given hostnames', async () => {
  const { vault, dir } = await makeVault();
  try {
    const ca = await getOrCreateCa(vault);
    const leaf = generateLeafCertificate(ca, ['localhost', '127.0.0.1']);
    assert.match(leaf.certificatePem, /^-----BEGIN CERTIFICATE-----/);
    assert.match(leaf.privateKeyPem, /^-----BEGIN PRIVATE KEY-----/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a generated leaf certificate verifies against its issuing CA with openssl', { skip: !hasOpenssl() }, async () => {
  const { vault, dir } = await makeVault();
  try {
    const ca = await getOrCreateCa(vault);
    const leaf = generateLeafCertificate(ca, DEFAULT_LEAF_HOSTNAMES);

    const caPath = join(mkdtempSync(join(tmpdir(), 'ship-leaf-openssl-')), 'ca.pem');
    writeFileSync(caPath, ca.certificatePem);
    const leafPath = join(mkdtempSync(join(tmpdir(), 'ship-leaf-openssl-')), 'leaf.pem');
    writeFileSync(leafPath, leaf.certificatePem);

    const output = execFileSync('openssl', ['verify', '-CAfile', caPath, leafPath], { encoding: 'utf8' });
    assert.match(output, /: OK/);

    const text = execFileSync('openssl', ['x509', '-in', leafPath, '-noout', '-text'], { encoding: 'utf8' });
    assert.match(text, /DNS:localhost/);
    assert.match(text, /IP Address:127\.0\.0\.1/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getOrCreateLeafCertificate persists and reuses the same certificate on repeat calls', async () => {
  const { vault, dir } = await makeVault();
  try {
    const ca = await getOrCreateCa(vault);
    const first = await getOrCreateLeafCertificate(vault, ca);
    const second = await getOrCreateLeafCertificate(vault, ca);
    assert.equal(second.certificatePem, first.certificatePem);

    const loaded = await loadLeafCertificate(vault);
    assert.equal(loaded.certificatePem, first.certificatePem);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getOrCreateLeafCertificate reissues automatically when the CA has rotated', async () => {
  const { vault, dir } = await makeVault();
  try {
    const ca = await getOrCreateCa(vault);
    const originalLeaf = await getOrCreateLeafCertificate(vault, ca);

    const rotatedCa = await rotateCa(vault);
    const reissuedLeaf = await getOrCreateLeafCertificate(vault, rotatedCa);

    assert.notEqual(reissuedLeaf.certificatePem, originalLeaf.certificatePem);
    assert.equal(reissuedLeaf.certificate.checkIssued(rotatedCa.certificate), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getOrCreateLeafCertificate keeps separate certificates per distinct hostname set', async () => {
  const { vault, dir } = await makeVault();
  try {
    const ca = await getOrCreateCa(vault);
    const forLocalhost = await getOrCreateLeafCertificate(vault, ca, ['localhost']);
    const forCustomHost = await getOrCreateLeafCertificate(vault, ca, ['dev.ship.local']);
    assert.notEqual(forLocalhost.certificatePem, forCustomHost.certificatePem);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
