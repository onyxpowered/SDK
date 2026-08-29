// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprintsMatch, normalizeFingerprint } from './Fingerprint.js';

test('Fingerprint: a missing previous fingerprint (first sample) always matches', () => {
  assert.equal(fingerprintsMatch(null, '12345'), true);
  assert.equal(fingerprintsMatch(undefined, '12345'), true);
});

test('Fingerprint: an identical fingerprint matches (same process, no PID reuse)', () => {
  assert.equal(fingerprintsMatch('12345', '12345'), true);
});

test('Fingerprint: a changed fingerprint does not match (PID was reused by a different process)', () => {
  assert.equal(fingerprintsMatch('12345', '99999'), false);
});

test('Fingerprint: a missing current fingerprint never matches an established one (treat as exited)', () => {
  assert.equal(fingerprintsMatch('12345', null), false);
  assert.equal(fingerprintsMatch('12345', undefined), false);
});

test('Fingerprint: normalizeFingerprint stringifies bigint start-time ticks consistently', () => {
  assert.equal(normalizeFingerprint(123456789n), '123456789');
});

test('Fingerprint: normalizeFingerprint stringifies numeric start times', () => {
  assert.equal(normalizeFingerprint(42), '42');
});

test('Fingerprint: normalizeFingerprint trims a raw lstart/StartTime string', () => {
  assert.equal(normalizeFingerprint('  Mon Aug 18 10:05:41 2026  '), 'Mon Aug 18 10:05:41 2026');
});

test('Fingerprint: normalizeFingerprint passes null/undefined through unchanged', () => {
  assert.equal(normalizeFingerprint(null), null);
  assert.equal(normalizeFingerprint(undefined), null);
});

test('Fingerprint: two different-typed but textually-identical raw values normalize to the same token', () => {
  assert.equal(normalizeFingerprint(123456789n), normalizeFingerprint('123456789'));
});
