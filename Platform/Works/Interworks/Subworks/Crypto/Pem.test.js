// SDK
// Designed & Built By onyxpowered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodePem, decodePem, decodePemChain } from './Pem.js';

test('encodePem wraps base64 at 64 characters with BEGIN/END markers', () => {
  const der = Buffer.from('a'.repeat(100));
  const pem = encodePem('CERTIFICATE', der);
  assert.match(pem, /^-----BEGIN CERTIFICATE-----\n/);
  assert.match(pem, /-----END CERTIFICATE-----\n$/);
  const bodyLines = pem.split('\n').slice(1, -2);
  for (const line of bodyLines) {
    assert.ok(line.length <= 64);
  }
});

test('decodePem recovers the original DER bytes', () => {
  const original = Buffer.from([1, 2, 3, 4, 250, 251, 252]);
  const pem = encodePem('CERTIFICATE REQUEST', original);
  const decoded = decodePem(pem);
  assert.equal(decoded.label, 'CERTIFICATE REQUEST');
  assert.deepEqual([...decoded.der], [...original]);
});

test('decodePem filters by expected label and throws when absent', () => {
  const pem = encodePem('PRIVATE KEY', Buffer.from([9]));
  assert.throws(() => decodePem(pem, 'CERTIFICATE'));
  const decoded = decodePem(pem, 'PRIVATE KEY');
  assert.equal(decoded.label, 'PRIVATE KEY');
});

test('decodePemChain returns every block in a multi-certificate PEM chain', () => {
  const leaf = encodePem('CERTIFICATE', Buffer.from([1]));
  const intermediate = encodePem('CERTIFICATE', Buffer.from([2]));
  const chain = decodePemChain(leaf + intermediate);
  assert.equal(chain.length, 2);
  assert.equal(chain[0].der[0], 1);
  assert.equal(chain[1].der[0], 2);
});

test('encodePem/decodePem round-trip an empty buffer', () => {
  const pem = encodePem('X', Buffer.alloc(0));
  const decoded = decodePem(pem);
  assert.equal(decoded.der.length, 0);
});
