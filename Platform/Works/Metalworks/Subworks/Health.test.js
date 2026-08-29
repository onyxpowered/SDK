// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createChannelHealth, channelSeverity, worseChannelState } from './Health.js';

function ns(ms) {
  return BigInt(ms) * 1_000_000n;
}

test('Health: starts ok', () => {
  const health = createChannelHealth();
  assert.equal(health.currentState(), 'ok');
});

test('Health: a single missed sample stays ok (retry silently, per the failure ladder)', () => {
  const health = createChannelHealth({ degradeAfterConsecutiveMisses: 4 });
  const result = health.recordMiss(ns(0));
  assert.equal(result.state, 'ok');
  assert.equal(health.currentState(), 'ok');
});

test('Health: a short run of consecutive misses (3-5 ticks) degrades the channel', () => {
  const health = createChannelHealth({ degradeAfterConsecutiveMisses: 4, downAfterMs: 999999 });
  health.recordMiss(ns(0));
  health.recordMiss(ns(100));
  health.recordMiss(ns(200));
  const result = health.recordMiss(ns(300));
  assert.equal(result.state, 'degraded');
  assert.equal(result.justDegraded, true);
});

test('Health: an intervening success resets the consecutive-miss counter, preventing degradation', () => {
  const health = createChannelHealth({ degradeAfterConsecutiveMisses: 4, downAfterMs: 999999 });
  health.recordMiss(ns(0));
  health.recordMiss(ns(100));
  health.recordSuccess();
  health.recordMiss(ns(200));
  const result = health.recordMiss(ns(300));
  assert.equal(result.state, 'ok');
});

test('Health: a sustained blackout of several seconds escalates straight to down', () => {
  const health = createChannelHealth({ degradeAfterConsecutiveMisses: 4, downAfterMs: 5000 });
  health.recordMiss(ns(0));
  health.recordMiss(ns(1000));
  health.recordMiss(ns(3000));
  const result = health.recordMiss(ns(5001));
  assert.equal(result.state, 'down');
  assert.equal(result.justEscalatedToDown, true);
});

test('Health: down->ok recovery passes through degraded first, never straight back to ok', () => {
  const health = createChannelHealth({
    degradeAfterConsecutiveMisses: 2,
    downAfterMs: 1000,
    clearAfterConsecutiveGood: 3,
  });
  health.recordMiss(ns(0));
  health.recordMiss(ns(1500));
  assert.equal(health.currentState(), 'down');

  const afterFirstGood = health.recordSuccess();
  assert.equal(afterFirstGood.state, 'degraded');
  assert.notEqual(afterFirstGood.state, 'ok');
});

test('Health: clearing degraded requires N consecutive good samples, not just one (hysteresis)', () => {
  const health = createChannelHealth({
    degradeAfterConsecutiveMisses: 2,
    downAfterMs: 999999,
    clearAfterConsecutiveGood: 3,
  });
  health.recordMiss(ns(0));
  health.recordMiss(ns(100));
  assert.equal(health.currentState(), 'degraded');

  health.recordSuccess();
  assert.equal(health.currentState(), 'degraded');
  health.recordSuccess();
  assert.equal(health.currentState(), 'degraded');
  const result = health.recordSuccess();
  assert.equal(result.state, 'ok');
  assert.equal(result.justRecovered, true);
});

test('Health: a miss during hysteresis recovery resets the good-sample count', () => {
  const health = createChannelHealth({
    degradeAfterConsecutiveMisses: 2,
    downAfterMs: 999999,
    clearAfterConsecutiveGood: 3,
  });
  health.recordMiss(ns(0));
  health.recordMiss(ns(100));
  health.recordSuccess();
  health.recordSuccess();
  health.recordMiss(ns(200));
  assert.equal(health.currentState(), 'degraded');
  health.recordSuccess();
  health.recordSuccess();
  assert.equal(health.currentState(), 'degraded');
  const result = health.recordSuccess();
  assert.equal(result.state, 'ok');
});

test('Health: status() reports internal counters for diagnostics', () => {
  const health = createChannelHealth();
  health.recordMiss(ns(0));
  const status = health.status();
  assert.equal(status.state, 'ok');
  assert.equal(status.consecutiveMisses, 1);
});

test('Health: justEscalatedToDown only fires on the transition tick, not every subsequent miss', () => {
  const health = createChannelHealth({ degradeAfterConsecutiveMisses: 2, downAfterMs: 1000 });
  health.recordMiss(ns(0));
  health.recordMiss(ns(1500));
  const first = health.recordMiss(ns(2000));
  assert.equal(first.justEscalatedToDown, false);
  assert.equal(first.state, 'down');
});

test('Health: channelSeverity orders ok < degraded < down', () => {
  assert.ok(channelSeverity('ok') < channelSeverity('degraded'));
  assert.ok(channelSeverity('degraded') < channelSeverity('down'));
});

test('Health: worseChannelState picks the more severe of two states, either order', () => {
  assert.equal(worseChannelState('ok', 'degraded'), 'degraded');
  assert.equal(worseChannelState('degraded', 'ok'), 'degraded');
  assert.equal(worseChannelState('degraded', 'down'), 'down');
  assert.equal(worseChannelState('down', 'ok'), 'down');
});

test('Health: worseChannelState is idempotent for two equal states', () => {
  assert.equal(worseChannelState('degraded', 'degraded'), 'degraded');
});

test('Health: worseChannelState acts as a floor -- combining with down never yields anything better than down', () => {
  assert.equal(worseChannelState('down', 'ok'), 'down');
  assert.equal(worseChannelState('down', 'degraded'), 'down');
  assert.equal(worseChannelState('down', 'down'), 'down');
});
