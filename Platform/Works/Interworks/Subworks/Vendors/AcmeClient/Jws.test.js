// SDK
// Designed & Built By onyxpowered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verify as cryptoVerify } from 'node:crypto';
import { generateRsaKeyPair, generateEcKeyPair, getJwk } from '../../Crypto/Keys.js';
import { signJws } from './Jws.js';

function decode(b64u) {
  return Buffer.from(b64u, 'base64url');
}

test('signJws(RSA) produces a JWS whose protected header carries alg/url/nonce and an embedded jwk (no kid)', () => {
  const { privateKey, publicKey } = generateRsaKeyPair(2048);
  const jws = signJws({ privateKey, publicKey, payload: { hello: 'world' }, url: 'https://acme.test/new-order', nonce: 'abc123' });

  const header = JSON.parse(decode(jws.protected).toString('utf8'));
  assert.equal(header.alg, 'RS256');
  assert.equal(header.url, 'https://acme.test/new-order');
  assert.equal(header.nonce, 'abc123');
  assert.deepEqual(header.jwk, getJwk(publicKey));
  assert.equal(header.kid, undefined);

  const payload = JSON.parse(decode(jws.payload).toString('utf8'));
  assert.deepEqual(payload, { hello: 'world' });
});

test('signJws uses kid instead of jwk once an account URL (kid) is known', () => {
  const { privateKey, publicKey } = generateRsaKeyPair(2048);
  const jws = signJws({ privateKey, publicKey, payload: {}, url: 'https://acme.test/order/1', kid: 'https://acme.test/acct/1' });
  const header = JSON.parse(decode(jws.protected).toString('utf8'));
  assert.equal(header.kid, 'https://acme.test/acct/1');
  assert.equal(header.jwk, undefined);
});

test('signJws encodes a POST-as-GET (empty string payload) as an empty payload segment', () => {
  const { privateKey, publicKey } = generateEcKeyPair('P-256');
  const jws = signJws({ privateKey, publicKey, payload: '', url: 'https://acme.test/order/1', kid: 'https://acme.test/acct/1' });
  assert.equal(jws.payload, '');
});

test('the RSA JWS signature verifies against the signing input with PKCS1v15/RS256', () => {
  const { privateKey, publicKey } = generateRsaKeyPair(2048);
  const jws = signJws({ privateKey, publicKey, payload: { a: 1 }, url: 'https://acme.test/x', nonce: 'n1' });
  const signingInput = Buffer.from(`${jws.protected}.${jws.payload}`);
  const ok = cryptoVerify('sha256', signingInput, publicKey, decode(jws.signature));
  assert.equal(ok, true);
});

test('the EC JWS signature verifies with the raw r||s (ieee-p1363) encoding RFC 7518 requires', () => {
  const { privateKey, publicKey } = generateEcKeyPair('P-256');
  const jws = signJws({ privateKey, publicKey, payload: { a: 1 }, url: 'https://acme.test/x', nonce: 'n1' });
  const signingInput = Buffer.from(`${jws.protected}.${jws.payload}`);
  const signature = decode(jws.signature);

  assert.equal(signature.length, 64);

  const ok = cryptoVerify('sha256', signingInput, { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature);
  assert.equal(ok, true);

  const header = JSON.parse(decode(jws.protected).toString('utf8'));
  assert.equal(header.alg, 'ES256');
});

test('EC P-384 signs with ES384 and a 96-byte raw signature', () => {
  const { privateKey, publicKey } = generateEcKeyPair('P-384');
  const jws = signJws({ privateKey, publicKey, payload: {}, url: 'https://acme.test/x' });
  const header = JSON.parse(decode(jws.protected).toString('utf8'));
  assert.equal(header.alg, 'ES384');
  assert.equal(decode(jws.signature).length, 96);
});
