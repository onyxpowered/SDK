// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { computeBackoffDelay, createRestartPolicy } from './Restart.js';

test('Restart: computeBackoffDelay doubles by default, attempt 1 equals the base delay', () => {
  assert.equal(computeBackoffDelay(1), 1000);
  assert.equal(computeBackoffDelay(2), 2000);
  assert.equal(computeBackoffDelay(3), 4000);
  assert.equal(computeBackoffDelay(4), 8000);
});

test('Restart: computeBackoffDelay caps at maxMs instead of growing unbounded', () => {
  assert.equal(computeBackoffDelay(10, { maxMs: 60000 }), 60000);
  assert.equal(computeBackoffDelay(20, { maxMs: 60000 }), 60000);
});

test('Restart: computeBackoffDelay honors a custom base and factor', () => {
  assert.equal(computeBackoffDelay(1, { baseMs: 500, factor: 3 }), 500);
  assert.equal(computeBackoffDelay(2, { baseMs: 500, factor: 3 }), 1500);
  assert.equal(computeBackoffDelay(3, { baseMs: 500, factor: 3 }), 4500);
});

test('Restart: computeBackoffDelay rejects a non-positive or non-integer attempt', () => {
  assert.throws(() => computeBackoffDelay(0), /positive integer/);
  assert.throws(() => computeBackoffDelay(-1), /positive integer/);
  assert.throws(() => computeBackoffDelay(1.5), /positive integer/);
});

test('Restart: createRestartPolicy escalates the delay on consecutive crashes with no stable running window', () => {
  const policy = createRestartPolicy({ baseMs: 1000, factor: 2, maxMs: 60000 });
  assert.equal(policy.recordCrash(), 1000);
  assert.equal(policy.recordCrash(), 2000);
  assert.equal(policy.recordCrash(), 4000);
  assert.equal(policy.getAttemptCount(), 3);
});

test('Restart: createRestartPolicy resets the attempt counter after a long stable run before the next crash', () => {
  let clock = 0;
  const policy = createRestartPolicy({ baseMs: 1000, factor: 2, stableResetMs: 60000, now: () => clock });
  assert.equal(policy.recordCrash(), 1000);
  assert.equal(policy.recordCrash(), 2000);
  policy.recordRunning();
  clock += 61000;
  assert.equal(policy.recordCrash(), 1000);
  assert.equal(policy.getAttemptCount(), 1);
});

test('Restart: createRestartPolicy does not reset when the running window was shorter than stableResetMs', () => {
  let clock = 0;
  const policy = createRestartPolicy({ baseMs: 1000, factor: 2, stableResetMs: 60000, now: () => clock });
  policy.recordCrash();
  policy.recordRunning();
  clock += 5000;
  assert.equal(policy.recordCrash(), 2000);
  assert.equal(policy.getAttemptCount(), 2);
});

test('Restart: createRestartPolicy recordDeliberateStop clears the attempt counter, exempting it from backoff', () => {
  const policy = createRestartPolicy();
  policy.recordCrash();
  policy.recordCrash();
  assert.equal(policy.getAttemptCount(), 2);
  policy.recordDeliberateStop();
  assert.equal(policy.getAttemptCount(), 0);
  assert.equal(policy.recordCrash(), 1000);
});

test('Restart: createRestartPolicy getAttemptCount starts at zero before any crash', () => {
  const policy = createRestartPolicy();
  assert.equal(policy.getAttemptCount(), 0);
});
