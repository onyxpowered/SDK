// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCpuPercent,
  parseMemoryBytes,
  evaluatePerBlockBreach,
  evaluateUniversalBreach,
  DEFAULT_UNIVERSAL_CEILING,
} from './Thresholds.js';

test('Thresholds: parseCpuPercent reads a whole-machine-relative percentage string', () => {
  assert.equal(parseCpuPercent('50%'), 50);
  assert.equal(parseCpuPercent('12.5%'), 12.5);
});

test('Thresholds: parseCpuPercent rejects a malformed percentage', () => {
  assert.throws(() => parseCpuPercent('50'), /invalid cpu allowance/);
  assert.throws(() => parseCpuPercent('fifty%'), /invalid cpu allowance/);
});

test('Thresholds: parseMemoryBytes converts every supported unit to bytes', () => {
  assert.equal(parseMemoryBytes('512b'), 512);
  assert.equal(parseMemoryBytes('1kb'), 1024);
  assert.equal(parseMemoryBytes('512mb'), 512 * 1024 * 1024);
  assert.equal(parseMemoryBytes('1GB'), 1024 * 1024 * 1024);
});

test('Thresholds: parseMemoryBytes rejects an unsupported unit', () => {
  assert.throws(() => parseMemoryBytes('512tb'), /invalid memory allowance/);
  assert.throws(() => parseMemoryBytes('512'), /invalid memory allowance/);
});

test('Thresholds: evaluatePerBlockBreach returns null for a sample within its allowance', () => {
  const sample = { cpuPercent: 10, rssBytes: 100 * 1024 * 1024, alive: true, stale: false };
  assert.equal(evaluatePerBlockBreach(sample, { cpu: '50%', memory: '512mb' }), null);
});

test('Thresholds: evaluatePerBlockBreach flags a cpu breach', () => {
  const sample = { cpuPercent: 75, rssBytes: 0, alive: true, stale: false };
  const breaches = evaluatePerBlockBreach(sample, { cpu: '50%' });
  assert.deepEqual(breaches, [{ tier: 'per-block', metric: 'cpu', value: 75, limit: 50 }]);
});

test('Thresholds: evaluatePerBlockBreach flags a memory breach', () => {
  const sample = { cpuPercent: 0, rssBytes: 600 * 1024 * 1024, alive: true, stale: false };
  const breaches = evaluatePerBlockBreach(sample, { memory: '512mb' });
  assert.deepEqual(breaches, [
    { tier: 'per-block', metric: 'memory', value: 600 * 1024 * 1024, limit: 512 * 1024 * 1024 },
  ]);
});

test('Thresholds: evaluatePerBlockBreach can flag both cpu and memory in the same tick', () => {
  const sample = { cpuPercent: 90, rssBytes: 900 * 1024 * 1024, alive: true, stale: false };
  const breaches = evaluatePerBlockBreach(sample, { cpu: '50%', memory: '512mb' });
  assert.equal(breaches.length, 2);
  assert.ok(breaches.some((b) => b.metric === 'cpu'));
  assert.ok(breaches.some((b) => b.metric === 'memory'));
});

test('Thresholds: evaluatePerBlockBreach never flags cpu on a fresh Block with cpuPercent still null', () => {
  const sample = { cpuPercent: null, rssBytes: 900 * 1024 * 1024, alive: true, stale: false };
  const breaches = evaluatePerBlockBreach(sample, { cpu: '50%' });
  assert.equal(breaches, null);
});

test('Thresholds: evaluatePerBlockBreach returns null for a stale sample, even if the numbers look breached', () => {
  const sample = { cpuPercent: 99, rssBytes: 999999999, alive: true, stale: true };
  assert.equal(evaluatePerBlockBreach(sample, { cpu: '1%' }), null);
});

test('Thresholds: evaluatePerBlockBreach returns null when the sample reports the process as not alive', () => {
  const sample = { cpuPercent: 99, rssBytes: 999999999, alive: false, stale: false };
  assert.equal(evaluatePerBlockBreach(sample, { cpu: '1%' }), null);
});

test('Thresholds: evaluatePerBlockBreach returns null when no allowance is configured at all', () => {
  const sample = { cpuPercent: 100, rssBytes: 100, alive: true, stale: false };
  assert.equal(evaluatePerBlockBreach(sample, {}), null);
});

test('Thresholds: evaluatePerBlockBreach returns null for a missing sample (no telemetry yet)', () => {
  assert.equal(evaluatePerBlockBreach(null, { cpu: '50%' }), null);
});

test('Thresholds: evaluateUniversalBreach returns null when the machine is within the default ceiling', () => {
  const systemSample = { cpuPercent: 40, memory: { totalBytes: 1000, usedBytes: 400, freeBytes: 600 } };
  assert.equal(evaluateUniversalBreach(systemSample), null);
});

test('Thresholds: evaluateUniversalBreach flags a cpu breach against the default 90% ceiling', () => {
  const systemSample = { cpuPercent: 95, memory: { totalBytes: 1000, usedBytes: 100, freeBytes: 900 } };
  const breaches = evaluateUniversalBreach(systemSample);
  assert.deepEqual(breaches, [{ tier: 'universal', metric: 'cpu', value: 95, limit: 90 }]);
});

test('Thresholds: evaluateUniversalBreach flags a memory breach as a ratio, not raw bytes', () => {
  const systemSample = { cpuPercent: 0, memory: { totalBytes: 1000, usedBytes: 950, freeBytes: 50 } };
  const breaches = evaluateUniversalBreach(systemSample);
  assert.deepEqual(breaches, [{ tier: 'universal', metric: 'memory', value: 0.95, limit: 0.9 }]);
});

test('Thresholds: evaluateUniversalBreach honors a custom ceiling', () => {
  const systemSample = { cpuPercent: 60, memory: { totalBytes: 1000, usedBytes: 500, freeBytes: 500 } };
  assert.equal(evaluateUniversalBreach(systemSample, { cpuPercent: 50 }).length, 1);
});

test('Thresholds: DEFAULT_UNIVERSAL_CEILING is 90% cpu and 90% memory', () => {
  assert.deepEqual(DEFAULT_UNIVERSAL_CEILING, { cpuPercent: 90, memoryRatio: 0.9 });
});
