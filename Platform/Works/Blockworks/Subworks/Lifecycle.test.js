// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { STATES, nextLifecycleState, isDeliberateStopEvent, createBlockLifecycle } from './Lifecycle.js';

test('Lifecycle: STATES holds exactly the five settled top-level states', () => {
  assert.deepEqual(STATES, ['starting', 'running', 'crashed', 'stopped', 'restarting']);
});

test('Lifecycle: nextLifecycleState walks the full happy path starting -> running -> crashed -> restarting -> starting', () => {
  assert.equal(nextLifecycleState('starting', 'ready'), 'running');
  assert.equal(nextLifecycleState('running', 'unexpected-exit'), 'crashed');
  assert.equal(nextLifecycleState('crashed', 'schedule-restart'), 'restarting');
  assert.equal(nextLifecycleState('restarting', 'attempt'), 'starting');
});

test('Lifecycle: a deliberate stop reaches "stopped" from every non-terminal state', () => {
  assert.equal(nextLifecycleState('starting', 'stop'), 'stopped');
  assert.equal(nextLifecycleState('running', 'stop'), 'stopped');
  assert.equal(nextLifecycleState('crashed', 'stop'), 'stopped');
  assert.equal(nextLifecycleState('restarting', 'stop'), 'stopped');
});

test('Lifecycle: stopped only ever transitions forward via an explicit start', () => {
  assert.equal(nextLifecycleState('stopped', 'start'), 'starting');
  assert.throws(() => nextLifecycleState('stopped', 'ready'), /invalid lifecycle transition/);
});

test('Lifecycle: starting can crash via spawn failure or a readiness timeout, not just an exit', () => {
  assert.equal(nextLifecycleState('starting', 'spawn-failed'), 'crashed');
  assert.equal(nextLifecycleState('starting', 'readiness-timeout'), 'crashed');
});

test('Lifecycle: an unknown starting state throws', () => {
  assert.throws(() => nextLifecycleState('paused', 'ready'), /unknown lifecycle state/);
});

test('Lifecycle: an event with no transition from the current state throws with both named', () => {
  assert.throws(
    () => nextLifecycleState('running', 'ready'),
    /cannot "ready" from "running"/,
  );
});

test('Lifecycle: isDeliberateStopEvent only recognizes "stop"', () => {
  assert.equal(isDeliberateStopEvent('stop'), true);
  assert.equal(isDeliberateStopEvent('unexpected-exit'), false);
});

test('Lifecycle: createBlockLifecycle starts in "starting" by default with throttled false', () => {
  const lifecycle = createBlockLifecycle();
  assert.equal(lifecycle.getState(), 'starting');
  assert.equal(lifecycle.isThrottled(), false);
});

test('Lifecycle: createBlockLifecycle accepts a reconciliation-time initial state', () => {
  const lifecycle = createBlockLifecycle('running');
  assert.equal(lifecycle.getState(), 'running');
});

test('Lifecycle: createBlockLifecycle rejects an unknown initial state', () => {
  assert.throws(() => createBlockLifecycle('paused'), /unknown lifecycle state/);
});

test('Lifecycle: transition() mutates and returns the new state', () => {
  const lifecycle = createBlockLifecycle();
  const result = lifecycle.transition('ready');
  assert.equal(result, 'running');
  assert.equal(lifecycle.getState(), 'running');
});

test('Lifecycle: setThrottled can only be turned on while running', () => {
  const lifecycle = createBlockLifecycle('running');
  lifecycle.setThrottled(true);
  assert.equal(lifecycle.isThrottled(), true);
});

test('Lifecycle: setThrottled throws when the Block is not running', () => {
  const lifecycle = createBlockLifecycle('starting');
  assert.throws(() => lifecycle.setThrottled(true), /cannot throttle a Block that is not running/);
});

test('Lifecycle: throttled is a flag on running, not a state -- leaving running clears it automatically', () => {
  const lifecycle = createBlockLifecycle('running');
  lifecycle.setThrottled(true);
  assert.equal(lifecycle.getState(), 'running');
  assert.equal(lifecycle.isThrottled(), true);
  lifecycle.transition('unexpected-exit');
  assert.equal(lifecycle.getState(), 'crashed');
  assert.equal(lifecycle.isThrottled(), false);
});

test('Lifecycle: a deliberate stop while throttled and running clears the throttle flag too', () => {
  const lifecycle = createBlockLifecycle('running');
  lifecycle.setThrottled(true);
  lifecycle.transition('stop');
  assert.equal(lifecycle.getState(), 'stopped');
  assert.equal(lifecycle.isThrottled(), false);
});

test('Lifecycle: an invalid transition attempt does not mutate the current state', () => {
  const lifecycle = createBlockLifecycle('stopped');
  assert.throws(() => lifecycle.transition('ready'));
  assert.equal(lifecycle.getState(), 'stopped');
});
