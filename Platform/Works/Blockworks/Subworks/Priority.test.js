// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { rankThrottleCandidates, selectThrottleTarget } from './Priority.js';

test('Priority: rankThrottleCandidates puts low-priority Blocks ahead of normal and high', () => {
  const candidates = [
    { name: 'web', priority: 'high', cpuPercent: 10 },
    { name: 'cron', priority: 'low', cpuPercent: 5 },
    { name: 'worker', priority: 'normal', cpuPercent: 20 },
  ];
  const ranked = rankThrottleCandidates(candidates, 'cpu').map((c) => c.name);
  assert.deepEqual(ranked, ['cron', 'worker', 'web']);
});

test('Priority: within the same tier, the biggest offender by the breached metric goes first', () => {
  const candidates = [
    { name: 'a', priority: 'low', cpuPercent: 10 },
    { name: 'b', priority: 'low', cpuPercent: 90 },
    { name: 'c', priority: 'low', cpuPercent: 40 },
  ];
  const ranked = rankThrottleCandidates(candidates, 'cpu').map((c) => c.name);
  assert.deepEqual(ranked, ['b', 'c', 'a']);
});

test('Priority: rankThrottleCandidates ranks by rssBytes when the breached metric is memory', () => {
  const candidates = [
    { name: 'a', priority: 'normal', rssBytes: 100 },
    { name: 'b', priority: 'normal', rssBytes: 900 },
  ];
  const ranked = rankThrottleCandidates(candidates, 'memory').map((c) => c.name);
  assert.deepEqual(ranked, ['b', 'a']);
});

test('Priority: rankThrottleCandidates never mutates the input array', () => {
  const candidates = [
    { name: 'a', priority: 'high', cpuPercent: 1 },
    { name: 'b', priority: 'low', cpuPercent: 1 },
  ];
  const copy = [...candidates];
  rankThrottleCandidates(candidates, 'cpu');
  assert.deepEqual(candidates, copy);
});

test('Priority: rankThrottleCandidates throws on an unrecognized priority tier', () => {
  assert.throws(
    () => rankThrottleCandidates([{ name: 'a', priority: 'urgent', cpuPercent: 1 }], 'cpu'),
    /unknown priority tier/,
  );
});

test('Priority: rankThrottleCandidates throws on an unrecognized metric', () => {
  assert.throws(
    () => rankThrottleCandidates([{ name: 'a', priority: 'low', cpuPercent: 1 }], 'disk'),
    /unknown throttle metric/,
  );
});

test('Priority: selectThrottleTarget returns the top-ranked candidate by default', () => {
  const candidates = [
    { name: 'web', priority: 'high', cpuPercent: 10 },
    { name: 'cron', priority: 'low', cpuPercent: 5 },
  ];
  assert.equal(selectThrottleTarget(candidates, 'cpu').name, 'cron');
});

test('Priority: selectThrottleTarget skips candidates already at max throttle', () => {
  const candidates = [
    { name: 'cron', priority: 'low', cpuPercent: 90, maxed: true },
    { name: 'worker', priority: 'normal', cpuPercent: 50, maxed: false },
  ];
  const target = selectThrottleTarget(candidates, 'cpu', { isExcluded: (c) => c.maxed });
  assert.equal(target.name, 'worker');
});

test('Priority: selectThrottleTarget returns null when every candidate is excluded', () => {
  const candidates = [{ name: 'cron', priority: 'low', cpuPercent: 90, maxed: true }];
  const target = selectThrottleTarget(candidates, 'cpu', { isExcluded: (c) => c.maxed });
  assert.equal(target, null);
});

test('Priority: selectThrottleTarget returns null for an empty candidate list', () => {
  assert.equal(selectThrottleTarget([], 'cpu'), null);
});
