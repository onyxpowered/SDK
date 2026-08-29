// SDK
// Designed & Built By onyxpowered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { X509Certificate } from 'node:crypto';
import { generateRsaKeyPair, generateEcKeyPair, exportPrivateKeyPem } from './Keys.js';
import { buildName, buildCsr, buildCertificate, parseCertificate, extractSubjectNameDer, parseIpv6ToBytes } from './X509.js';

function hasOpenssl() {
  try {
    execFileSync('openssl', ['version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function tempFile(name, contents) {
  const dir = mkdtempSync(join(tmpdir(), 'ship-x509-test-'));
  const filePath = join(dir, name);
  writeFileSync(filePath, contents);
  return filePath;
}

test('buildName omits absent fields and includes provided ones as RDNs', () => {
  const onlyCn = buildName({ CN: 'example.com' });
  assert.equal(onlyCn[0], 0x30);
  const withMore = buildName({ CN: 'example.com', C: 'US', O: 'onyxlabs' });
  assert.ok(withMore.length > onlyCn.length);
});

test('buildCsr produces a PEM CERTIFICATE REQUEST block', () => {
  const { privateKey, publicKey } = generateRsaKeyPair(2048);
  const pem = buildCsr({ privateKey, publicKey, commonName: 'test.example.com' });
  assert.match(pem, /^-----BEGIN CERTIFICATE REQUEST-----/);
  assert.match(pem, /-----END CERTIFICATE REQUEST-----\n$/);
});

test('buildCsr(RSA) is accepted by openssl as a structurally and cryptographically valid CSR', { skip: !hasOpenssl() }, () => {
  const { privateKey, publicKey } = generateRsaKeyPair(2048);
  const pem = buildCsr({ privateKey, publicKey, commonName: 'ship.local', altNames: ['alt.ship.local'] });
  const csrPath = tempFile('req.pem', pem);
  const output = execFileSync('openssl', ['req', '-in', csrPath, '-verify', '-noout', '-text'], {
    encoding: 'utf8',
  });
  assert.match(output, /Subject: CN\s*=\s*ship\.local/);
  assert.match(output, /DNS:ship\.local/);
  assert.match(output, /DNS:alt\.ship\.local/);
});

test('buildCsr(EC P-256) is accepted by openssl as a valid CSR', { skip: !hasOpenssl() }, () => {
  const { privateKey, publicKey } = generateEcKeyPair('P-256');
  const pem = buildCsr({ privateKey, publicKey, commonName: 'ec.ship.local' });
  const csrPath = tempFile('req-ec.pem', pem);
  const output = execFileSync('openssl', ['req', '-in', csrPath, '-verify', '-noout', '-text'], {
    encoding: 'utf8',
  });
  assert.match(output, /Public Key Algorithm: id-ecPublicKey/);
});

test('buildCertificate produces a self-signed CA certificate openssl accepts', { skip: !hasOpenssl() }, () => {
  const { privateKey, publicKey } = generateRsaKeyPair(2048);
  const name = buildName({ CN: 'Ship Local Dev CA' });
  const pem = buildCertificate({
    subjectPublicKey: publicKey,
    subjectName: name,
    issuerName: name,
    issuerPrivateKey: privateKey,
    isCA: true,
    pathLen: 0,
  });

  const certPath = tempFile('ca.pem', pem);
  const output = execFileSync('openssl', ['x509', '-in', certPath, '-noout', '-text'], { encoding: 'utf8' });
  assert.match(output, /CA:TRUE/);
  assert.match(output, /Certificate Sign/);

  execFileSync('openssl', ['verify', '-CAfile', certPath, certPath], { encoding: 'utf8' });
});

test('buildCertificate issues a leaf certificate that chains to and verifies against the CA', { skip: !hasOpenssl() }, () => {
  const ca = generateRsaKeyPair(2048);
  const caName = buildName({ CN: 'Ship Local Dev CA' });
  const caCertPem = buildCertificate({
    subjectPublicKey: ca.publicKey,
    subjectName: caName,
    issuerName: caName,
    issuerPrivateKey: ca.privateKey,
    isCA: true,
  });

  const leaf = generateRsaKeyPair(2048);
  const leafName = buildName({ CN: 'localhost' });
  const leafCertPem = buildCertificate({
    subjectPublicKey: leaf.publicKey,
    subjectName: leafName,
    issuerName: caName,
    issuerPrivateKey: ca.privateKey,
    altNames: ['localhost', '127.0.0.1'],
  });

  const caCertPath = tempFile('ca.pem', caCertPem);
  const leafCertPath = tempFile('leaf.pem', leafCertPem);

  const output = execFileSync(
    'openssl',
    ['verify', '-CAfile', caCertPath, leafCertPath],
    { encoding: 'utf8' },
  );
  assert.match(output, /: OK/);

  const text = execFileSync('openssl', ['x509', '-in', leafCertPath, '-noout', '-text'], { encoding: 'utf8' });
  assert.match(text, /DNS:localhost/);
  assert.match(text, /IP Address:127\.0\.0\.1/);
});

test('parseIpv6ToBytes expands "::" zero-compression to a full 16-byte address', () => {
  assert.equal(parseIpv6ToBytes('::1').toString('hex'), '00000000000000000000000000000001');
  assert.equal(parseIpv6ToBytes('::').toString('hex'), '00000000000000000000000000000000');
  assert.equal(parseIpv6ToBytes('2001:db8::1').toString('hex'), '20010db8000000000000000000000001');
  assert.equal(
    parseIpv6ToBytes('fe80::1:2:3:4').toString('hex'),
    'fe800000000000000001000200030004',
  );
});

test('parseIpv6ToBytes handles a fully-expanded address with no "::" compression', () => {
  const bytes = parseIpv6ToBytes('2001:0db8:0000:0000:0000:0000:0000:0001');
  assert.equal(bytes.toString('hex'), '20010db8000000000000000000000001');
  assert.equal(bytes.length, 16);
});

test('an IPv6 loopback subjectAltName produces a valid 16-byte iPAddress GeneralName openssl accepts', { skip: !hasOpenssl() }, () => {
  const { privateKey, publicKey } = generateRsaKeyPair(2048);
  const name = buildName({ CN: 'localhost' });
  const pem = buildCertificate({
    subjectPublicKey: publicKey,
    subjectName: name,
    issuerName: name,
    issuerPrivateKey: privateKey,
    altNames: ['localhost', '127.0.0.1', '::1'],
  });

  const certPath = tempFile('ipv6-leaf.pem', pem);
  const text = execFileSync('openssl', ['x509', '-in', certPath, '-noout', '-text'], { encoding: 'utf8' });
  assert.match(text, /IP Address:0:0:0:0:0:0:0:1/);
});

test('buildCertificate output round-trips through node:crypto.X509Certificate', () => {
  const { privateKey, publicKey } = generateRsaKeyPair(2048);
  const name = buildName({ CN: 'localhost' });
  const pem = buildCertificate({
    subjectPublicKey: publicKey,
    subjectName: name,
    issuerName: name,
    issuerPrivateKey: privateKey,
    altNames: ['localhost'],
  });

  const cert = parseCertificate(pem);
  assert.ok(cert instanceof X509Certificate);
  assert.match(cert.subject, /CN=localhost/);
  assert.equal(cert.checkPrivateKey(privateKey), true);
  assert.ok(cert.subjectAltName.includes('DNS:localhost'));
});

test('extractSubjectNameDer recovers the exact subject Name bytes used to build a certificate, usable as the next cert\'s issuer', { skip: !hasOpenssl() }, () => {
  const ca = generateRsaKeyPair(2048);
  const caName = buildName({ CN: 'Ship Local Development CA', O: 'onyxlabs', OU: 'Ship' });
  const caCertPem = buildCertificate({
    subjectPublicKey: ca.publicKey,
    subjectName: caName,
    issuerName: caName,
    issuerPrivateKey: ca.privateKey,
    isCA: true,
  });

  const recoveredIssuerName = extractSubjectNameDer(caCertPem);
  assert.deepEqual([...recoveredIssuerName], [...caName]);

  const leaf = generateRsaKeyPair(2048);
  const leafCertPem = buildCertificate({
    subjectPublicKey: leaf.publicKey,
    subjectName: buildName({ CN: 'localhost' }),
    issuerName: recoveredIssuerName,
    issuerPrivateKey: ca.privateKey,
    altNames: ['localhost'],
  });

  const caPath = tempFile('ca.pem', caCertPem);
  const leafPath = tempFile('leaf.pem', leafCertPem);
  const output = execFileSync('openssl', ['verify', '-CAfile', caPath, leafPath], { encoding: 'utf8' });
  assert.match(output, /: OK/);

  const text = execFileSync('openssl', ['x509', '-in', leafPath, '-noout', '-text'], { encoding: 'utf8' });
  assert.match(text, /Issuer: .*O\s*=\s*onyxlabs/);
});

test('a certificate signed by an EC CA key verifies its own ECDSA signature', () => {
  const ca = generateEcKeyPair('P-256');
  const caName = buildName({ CN: 'Ship EC Dev CA' });
  const pem = buildCertificate({
    subjectPublicKey: ca.publicKey,
    subjectName: caName,
    issuerName: caName,
    issuerPrivateKey: ca.privateKey,
    isCA: true,
  });
  const cert = parseCertificate(pem);
  assert.equal(cert.checkIssued(cert), true);
  assert.equal(cert.ca, true);
});
