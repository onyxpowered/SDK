// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSystemCpuPercent } from './SystemCpu.js';

function cpu(user, nice, sys, idle, irq = 0) {
  return { model: 'test', speed: 0, times: { user, nice, sys, idle, irq } };
}

test('SystemCpu: computes whole-machine busy percent from two os.cpus() snapshots', () => {
  const previous = [cpu(1000, 0, 1000, 8000), cpu(1000, 0, 1000, 8000)];
  const current = [cpu(1500, 0, 1250, 8250), cpu(1500, 0, 1250, 8250)];
  const percent = computeSystemCpuPercent(previous, current, 'linux');
  assert.equal(percent, 75);
});

test('SystemCpu: a fully idle machine reports 0 percent', () => {
  const previous = [cpu(0, 0, 0, 0)];
  const current = [cpu(0, 0, 0, 1000)];
  assert.equal(computeSystemCpuPercent(previous, current, 'darwin'), 0);
});

test('SystemCpu: a fully busy machine reports 100 percent', () => {
  const previous = [cpu(0, 0, 0, 0)];
  const current = [cpu(1000, 0, 0, 0)];
  assert.equal(computeSystemCpuPercent(previous, current, 'darwin'), 100);
});

test('SystemCpu: returns null when total delta is zero or negative (jitter/suspend guard)', () => {
  const snapshot = [cpu(1000, 0, 1000, 8000)];
  assert.equal(computeSystemCpuPercent(snapshot, snapshot, 'linux'), null);
});

test('SystemCpu: returns null for mismatched or empty core-count snapshots', () => {
  assert.equal(computeSystemCpuPercent([], [], 'linux'), null);
  assert.equal(computeSystemCpuPercent([cpu(0, 0, 0, 0)], [cpu(0, 0, 0, 0), cpu(0, 0, 0, 0)], 'linux'), null);
  assert.equal(computeSystemCpuPercent(null, [cpu(0, 0, 0, 0)], 'linux'), null);
});

test('SystemCpu: on win32, subtracts irq from sys before computing the idle ratio (matches vendored systeminformation correction)', () => {
  const previous = [cpu(0, 0, 0, 0, 0)];
  const current = [cpu(0, 0, 500, 500, 500)];

  const winPercent = computeSystemCpuPercent(previous, current, 'win32');
  const naiveTotal = 0 + 0 + 500 + 500 + 500;
  const naiveBusy = naiveTotal - 500;
  const naivePercent = (naiveBusy / naiveTotal) * 100;
  assert.notEqual(winPercent, naivePercent);

  const correctedSys = Math.max(0, 500 - 500);
  const correctedTotal = 0 + 0 + correctedSys + 500 + 500;
  const correctedBusy = correctedTotal - 500;
  const expected = (correctedBusy / correctedTotal) * 100;
  assert.equal(winPercent, expected);
  assert.equal(winPercent, 50);
});

test('SystemCpu: win32 irq correction never lets the corrected sys value go negative', () => {
  const previous = [cpu(0, 0, 0, 0, 0)];
  const current = [cpu(0, 0, 100, 900, 9999)];
  const percent = computeSystemCpuPercent(previous, current, 'win32');
  assert.ok(percent !== null && percent >= 0 && percent <= 100);
});

test('SystemCpu: linux/darwin do not apply the irq correction (sys is used as-is)', () => {
  const previous = [cpu(0, 0, 0, 0, 0)];
  const current = [cpu(0, 0, 500, 500, 500)];
  const percent = computeSystemCpuPercent(previous, current, 'linux');
  const total = 0 + 0 + 500 + 500 + 500;
  const busy = total - 500;
  assert.equal(percent, (busy / total) * 100);
});

test('SystemCpu: clamps the result to the 0-100 range even under pathological input', () => {
  const previous = [cpu(0, 0, 0, 1000)];
  const current = [cpu(0, 0, 0, 500)];
  const percent = computeSystemCpuPercent(previous, current, 'linux');
  assert.ok(percent >= 0 && percent <= 100);
});

test('SystemCpu: one fully-pinned core out of eight reports ~12.5 percent whole-machine (matches Plan.txt section 7 example)', () => {
  const previous = [cpu(0, 0, 0, 0), ...Array.from({ length: 7 }, () => cpu(0, 0, 0, 0))];
  const current = [cpu(1000, 0, 0, 0), ...Array.from({ length: 7 }, () => cpu(0, 0, 0, 1000))];
  const percent = computeSystemCpuPercent(previous, current, 'linux');
  assert.equal(percent, 12.5);
});
