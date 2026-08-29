// SDK
// Designed & Built By onyxpowered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verify as cryptoVerify } from 'node:crypto';
import {
  generateRsaKeyPair,
  generateEcKeyPair,
  exportPrivateKeyPem,
  importPrivateKeyPem,
  publicKeyFromPrivateKey,
  exportPublicKeySpkiDer,
  getJwk,
  jwkThumbprint,
  signatureAlgorithmForKey,
  signTbs,
} from './Keys.js';

test('generateRsaKeyPair produces an importable PKCS8 PEM private key', () => {
  const { privateKey } = generateRsaKeyPair(2048);
  const pem = exportPrivateKeyPem(privateKey);
  assert.match(pem, /^-----BEGIN PRIVATE KEY-----/);
  const reimported = importPrivateKeyPem(pem);
  assert.equal(reimported.asymmetricKeyType, 'rsa');
});

test('generateEcKeyPair defaults to P-256 and reports it via the JWK crv', () => {
  const { publicKey } = generateEcKeyPair();
  const jwk = getJwk(publicKey);
  assert.equal(jwk.kty, 'EC');
  assert.equal(jwk.crv, 'P-256');
});

test('exportPublicKeySpkiDer returns a DER SubjectPublicKeyInfo starting with SEQUENCE', () => {
  const { publicKey } = generateRsaKeyPair(2048);
  const der = exportPublicKeySpkiDer(publicKey);
  assert.equal(der[0], 0x30);
});

test('publicKeyFromPrivateKey derives a usable public key from a private key', () => {
  const { privateKey, publicKey } = generateRsaKeyPair(2048);
  const derived = publicKeyFromPrivateKey(privateKey);
  assert.deepEqual(exportPublicKeySpkiDer(derived), exportPublicKeySpkiDer(publicKey));
});

test('jwkThumbprint matches the RFC 7638 appendix A.1 example vector', () => {
  const jwk = {
    kty: 'RSA',
    n:
      '0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAtVT86zwu1RK7aPFFxuhDR1L6tSoc_BJECPebWKRXjBZCiFV4n3oknjhMstn64tZ_2W-5JsGY4Hc5n9yBXArwl93lqt7_RN5w6Cf0h4QyQ5v-65YGjQR0_FDW2QvzqY368QQMicAtaSqzs8KJZgnYb9c7d0zgdAZHzu6qMQvRL5hajrn1n91CbOpbISD08qNLyrdkt-bFTWhAI4vMQFh6WeZu0fM4lFd2NcRwr3XPksINHaQ-G_xBniIqbw0Ls1jF44-csFCur-kEgU8awapJzKnqDKgw',
    e: 'AQAB',
    alg: 'RS256',
    kid: '2011-04-29',
  };
  assert.equal(jwkThumbprint(jwk), 'NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs');
});

test('jwkThumbprint ignores extra members and only hashes the canonical ones', () => {
  const base = { kty: 'RSA', n: 'abc', e: 'AQAB' };
  const withExtra = { ...base, alg: 'RS256', kid: 'x' };
  assert.equal(jwkThumbprint(base), jwkThumbprint(withExtra));
});

test('signatureAlgorithmForKey picks RS256/sha256WithRSAEncryption for RSA', () => {
  const { publicKey } = generateRsaKeyPair(2048);
  const alg = signatureAlgorithmForKey(publicKey);
  assert.equal(alg.hash, 'sha256');
  assert.equal(alg.oid, '1.2.840.113549.1.1.11');
  assert.equal(alg.jwsAlg, 'RS256');
});

test('signatureAlgorithmForKey picks the curve-matched ES alg and OID for EC keys', () => {
  const { publicKey: p256 } = generateEcKeyPair('P-256');
  assert.deepEqual(
    { hash: signatureAlgorithmForKey(p256).hash, alg: signatureAlgorithmForKey(p256).jwsAlg },
    { hash: 'sha256', alg: 'ES256' },
  );

  const { publicKey: p384 } = generateEcKeyPair('P-384');
  assert.deepEqual(
    { hash: signatureAlgorithmForKey(p384).hash, alg: signatureAlgorithmForKey(p384).jwsAlg },
    { hash: 'sha384', alg: 'ES384' },
  );
});

test('signTbs produces a signature that node:crypto.verify accepts for RSA', () => {
  const { privateKey, publicKey } = generateRsaKeyPair(2048);
  const tbs = Buffer.from('certification request info bytes');
  const signature = signTbs(privateKey, tbs);
  const ok = cryptoVerify('sha256', tbs, publicKey, signature);
  assert.equal(ok, true);
});

test('signTbs produces a DER-encoded signature that node:crypto.verify accepts for EC', () => {
  const { privateKey, publicKey } = generateEcKeyPair('P-256');
  const tbs = Buffer.from('certification request info bytes');
  const signature = signTbs(privateKey, tbs);
  assert.equal(signature[0], 0x30);
  const ok = cryptoVerify('sha256', tbs, publicKey, signature);
  assert.equal(ok, true);
});
