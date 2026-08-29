// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { computeProcessCpuPercent } from './ProcessCpu.js';

test('ProcessCpu: null previousCpuTimeMs (first sample) yields null, never a computed number', () => {
  const percent = computeProcessCpuPercent({
    previousCpuTimeMs: null,
    currentCpuTimeMs: 500,
    elapsedMs: 1000,
    coreCount: 8,
  });
  assert.equal(percent, null);
});

test('ProcessCpu: a process pinning one of eight cores reports ~12.5 percent whole-machine-relative', () => {
  const percent = computeProcessCpuPercent({
    previousCpuTimeMs: 0,
    currentCpuTimeMs: 1000,
    elapsedMs: 1000,
    coreCount: 8,
  });
  assert.equal(percent, 12.5);
});

test('ProcessCpu: a single-core-saturating process on a single-core machine reports 100 percent', () => {
  const percent = computeProcessCpuPercent({
    previousCpuTimeMs: 0,
    currentCpuTimeMs: 1000,
    elapsedMs: 1000,
    coreCount: 1,
  });
  assert.equal(percent, 100);
});

test('ProcessCpu: diffs against the ACTUAL measured wall-clock gap, not a nominal cadence', () => {
  const nominalCadenceMs = 150;
  const actualGapMs = 900;
  const percent = computeProcessCpuPercent({
    previousCpuTimeMs: 0,
    currentCpuTimeMs: 450,
    elapsedMs: actualGapMs,
    coreCount: 1,
  });
  const wrongPercentIfNominalUsed = (450 / nominalCadenceMs) * 100;
  assert.notEqual(percent, wrongPercentIfNominalUsed);
  assert.equal(percent, 50);
});

test('ProcessCpu: returns null for zero elapsed time (guards against jitter/duplicate ticks)', () => {
  const percent = computeProcessCpuPercent({
    previousCpuTimeMs: 100,
    currentCpuTimeMs: 200,
    elapsedMs: 0,
    coreCount: 4,
  });
  assert.equal(percent, null);
});

test('ProcessCpu: returns null for negative elapsed time (clock went backwards / sleep-resume)', () => {
  const percent = computeProcessCpuPercent({
    previousCpuTimeMs: 100,
    currentCpuTimeMs: 200,
    elapsedMs: -50,
    coreCount: 4,
  });
  assert.equal(percent, null);
});

test('ProcessCpu: a negative cpu-time delta (counter jitter, e.g. after a fingerprint miss) is floored at zero busy time, not negative percent', () => {
  const percent = computeProcessCpuPercent({
    previousCpuTimeMs: 500,
    currentCpuTimeMs: 400,
    elapsedMs: 1000,
    coreCount: 4,
  });
  assert.equal(percent, 0);
});

test('ProcessCpu: returns null when coreCount is missing, zero, or negative', () => {
  assert.equal(
    computeProcessCpuPercent({ previousCpuTimeMs: 0, currentCpuTimeMs: 100, elapsedMs: 1000, coreCount: 0 }),
    null,
  );
  assert.equal(
    computeProcessCpuPercent({ previousCpuTimeMs: 0, currentCpuTimeMs: 100, elapsedMs: 1000, coreCount: -2 }),
    null,
  );
  assert.equal(
    computeProcessCpuPercent({ previousCpuTimeMs: 0, currentCpuTimeMs: 100, elapsedMs: 1000 }),
    null,
  );
});

test('ProcessCpu: clamps the result at 100 even under pathological input', () => {
  const percent = computeProcessCpuPercent({
    previousCpuTimeMs: 0,
    currentCpuTimeMs: 999999,
    elapsedMs: 1000,
    coreCount: 1,
  });
  assert.equal(percent, 100);
});

test('ProcessCpu: an idle process (no cpu-time movement) reports exactly 0, not null, once a prior sample exists', () => {
  const percent = computeProcessCpuPercent({
    previousCpuTimeMs: 500,
    currentCpuTimeMs: 500,
    elapsedMs: 1000,
    coreCount: 4,
  });
  assert.equal(percent, 0);
});
