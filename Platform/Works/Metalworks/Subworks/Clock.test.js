// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { monotonicNowNs, elapsedMsBetween, nsToMs } from './Clock.js';

test('Clock: monotonicNowNs returns a bigint that increases across calls', () => {
  const a = monotonicNowNs();
  const b = monotonicNowNs();
  assert.equal(typeof a, 'bigint');
  assert.equal(typeof b, 'bigint');
  assert.ok(b >= a);
});

test('Clock: elapsedMsBetween computes a positive delta for normal forward time', () => {
  const start = 0n;
  const end = 5_000_000n;
  assert.equal(elapsedMsBetween(start, end), 5);
});

test('Clock: elapsedMsBetween returns null for zero elapsed time', () => {
  assert.equal(elapsedMsBetween(10n, 10n), null);
});

test('Clock: elapsedMsBetween returns null for negative elapsed time (clock went backwards)', () => {
  assert.equal(elapsedMsBetween(10n, 5n), null);
});

test('Clock: elapsedMsBetween returns null when given non-bigint input', () => {
  assert.equal(elapsedMsBetween(Date.now(), Date.now() + 10), null);
  assert.equal(elapsedMsBetween(undefined, 5n), null);
  assert.equal(elapsedMsBetween(5n, undefined), null);
});

test('Clock: nsToMs converts bigint nanoseconds to a millisecond number', () => {
  assert.equal(nsToMs(1_500_000n), 1.5);
});

test('Clock: nsToMs returns null for non-bigint input', () => {
  assert.equal(nsToMs(1500), null);
});
