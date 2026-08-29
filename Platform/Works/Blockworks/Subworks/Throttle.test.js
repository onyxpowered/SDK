// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import {
  nextThrottleLevel,
  prevThrottleLevel,
  isMaxThrottleLevel,
  lowerPriority,
  restorePriority,
  createDutyCycle,
} from './Throttle.js';

function fakeTimers() {
  let scheduled = [];
  let nextId = 1;
  return {
    setTimeoutFn: (cb, ms) => {
      const id = nextId++;
      scheduled.push({ id, cb, ms });
      return id;
    },
    clearTimeoutFn: (id) => {
      scheduled = scheduled.filter((entry) => entry.id !== id);
    },
    fireNext() {
      const entry = scheduled.shift();
      if (!entry) throw new Error('no scheduled timer to fire');
      entry.cb();
      return entry.ms;
    },
    pendingCount() {
      return scheduled.length;
    },
  };
}

test('Throttle: nextThrottleLevel escalates none -> priority-lowered -> duty-cycled on POSIX', () => {
  assert.equal(nextThrottleLevel('none', 'linux'), 'priority-lowered');
  assert.equal(nextThrottleLevel('priority-lowered', 'linux'), 'duty-cycled');
  assert.equal(nextThrottleLevel('duty-cycled', 'linux'), 'duty-cycled');
});

test('Throttle: nextThrottleLevel tops out at priority-lowered on Windows, never reaching duty-cycled', () => {
  assert.equal(nextThrottleLevel('none', 'win32'), 'priority-lowered');
  assert.equal(nextThrottleLevel('priority-lowered', 'win32'), 'priority-lowered');
});

test('Throttle: prevThrottleLevel de-escalates one step at a time and floors at none', () => {
  assert.equal(prevThrottleLevel('duty-cycled', 'linux'), 'priority-lowered');
  assert.equal(prevThrottleLevel('priority-lowered', 'linux'), 'none');
  assert.equal(prevThrottleLevel('none', 'linux'), 'none');
});

test('Throttle: isMaxThrottleLevel reflects the platform-specific ceiling', () => {
  assert.equal(isMaxThrottleLevel('duty-cycled', 'linux'), true);
  assert.equal(isMaxThrottleLevel('priority-lowered', 'linux'), false);
  assert.equal(isMaxThrottleLevel('priority-lowered', 'win32'), true);
});

test('Throttle: nextThrottleLevel/prevThrottleLevel/isMaxThrottleLevel reject an unknown level', () => {
  assert.throws(() => nextThrottleLevel('paused'), /unknown throttle level/);
  assert.throws(() => prevThrottleLevel('paused'), /unknown throttle level/);
  assert.throws(() => isMaxThrottleLevel('paused'), /unknown throttle level/);
});

test('Throttle: lowerPriority calls os.setPriority with the low-priority constant by default', () => {
  let captured;
  lowerPriority(4242, { setPriorityFn: (pid, priority) => (captured = { pid, priority }) });
  assert.deepEqual(captured, { pid: 4242, priority: os.constants.priority.PRIORITY_LOW });
});

test('Throttle: restorePriority calls os.setPriority with the normal-priority constant by default', () => {
  let captured;
  restorePriority(4242, { setPriorityFn: (pid, priority) => (captured = { pid, priority }) });
  assert.deepEqual(captured, { pid: 4242, priority: os.constants.priority.PRIORITY_NORMAL });
});

test('Throttle: createDutyCycle alternates SIGSTOP and SIGCONT on its own schedule', () => {
  const timers = fakeTimers();
  const signals = [];
  const cycle = createDutyCycle(4242, {
    onMs: 200,
    offMs: 800,
    signalFn: (pid, signal) => signals.push({ pid, signal }),
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  cycle.start();
  assert.equal(cycle.getPhase(), 'on');
  assert.equal(timers.fireNext(), 200);
  assert.deepEqual(signals, [{ pid: 4242, signal: 'SIGSTOP' }]);
  assert.equal(cycle.getPhase(), 'off');

  assert.equal(timers.fireNext(), 800);
  assert.deepEqual(signals, [
    { pid: 4242, signal: 'SIGSTOP' },
    { pid: 4242, signal: 'SIGCONT' },
  ]);
  assert.equal(cycle.getPhase(), 'on');
});

test('Throttle: createDutyCycle.stop() while paused sends a final SIGCONT so the process never sticks stopped', () => {
  const timers = fakeTimers();
  const signals = [];
  const cycle = createDutyCycle(4242, {
    signalFn: (pid, signal) => signals.push({ pid, signal }),
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  cycle.start();
  timers.fireNext();
  assert.equal(cycle.getPhase(), 'off');

  cycle.stop();
  assert.deepEqual(signals.at(-1), { pid: 4242, signal: 'SIGCONT' });
  assert.equal(cycle.isRunning(), false);
  assert.equal(timers.pendingCount(), 0);
});

test('Throttle: createDutyCycle.stop() while running (not paused) sends no extra signal', () => {
  const timers = fakeTimers();
  const signals = [];
  const cycle = createDutyCycle(4242, {
    signalFn: (pid, signal) => signals.push({ pid, signal }),
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  cycle.start();
  cycle.stop();
  assert.deepEqual(signals, []);
});

test('Throttle: createDutyCycle.start() is idempotent when already running', () => {
  const timers = fakeTimers();
  const cycle = createDutyCycle(4242, {
    signalFn: () => {},
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });
  cycle.start();
  cycle.start();
  assert.equal(timers.pendingCount(), 1);
});
