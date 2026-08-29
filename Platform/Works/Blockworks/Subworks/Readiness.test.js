// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { pollUntil, waitForDependencies, waitForHealthCheck } from './Readiness.js';

function fakeClock(start = 0) {
  let time = start;
  return {
    now: () => time,
    sleepFn: async (ms) => {
      time += ms;
    },
  };
}

test('pollUntil resolves true as soon as the predicate passes, without sleeping first', async () => {
  const clock = fakeClock();
  let calls = 0;
  const result = await pollUntil(
    () => {
      calls += 1;
      return true;
    },
    { now: clock.now, sleepFn: clock.sleepFn },
  );
  assert.equal(result, true);
  assert.equal(calls, 1);
});

test('pollUntil retries on the given interval until the predicate passes', async () => {
  const clock = fakeClock();
  let calls = 0;
  const result = await pollUntil(
    () => {
      calls += 1;
      return calls >= 3;
    },
    { now: clock.now, sleepFn: clock.sleepFn, intervalMs: 100, timeoutMs: 10000 },
  );
  assert.equal(result, true);
  assert.equal(calls, 3);
});

test('pollUntil returns false once the virtual clock passes the deadline', async () => {
  const clock = fakeClock();
  const result = await pollUntil(() => false, {
    now: clock.now,
    sleepFn: clock.sleepFn,
    intervalMs: 100,
    timeoutMs: 350,
  });
  assert.equal(result, false);
});

test('waitForDependencies resolves immediately for a Block with no dependsOn, without polling', async () => {
  let called = false;
  const isBlockReady = async () => {
    called = true;
    return true;
  };
  const result = await waitForDependencies([], isBlockReady);
  assert.equal(result, true);
  assert.equal(called, false);
});

test('waitForDependencies waits until every declared dependency reports ready', async () => {
  const clock = fakeClock();
  const readyState = { web: false, db: false };
  setTimeout(() => {}, 0);
  const isBlockReady = async (name) => readyState[name];
  const promise = waitForDependencies(['web', 'db'], isBlockReady, {
    now: clock.now,
    sleepFn: async (ms) => {
      clock.sleepFn(ms);
      readyState.web = true;
      readyState.db = true;
    },
    intervalMs: 100,
    timeoutMs: 10000,
  });
  assert.equal(await promise, true);
});

test('waitForDependencies throws a clear timeout error naming the unmet dependencies', async () => {
  const clock = fakeClock();
  const isBlockReady = async () => false;
  await assert.rejects(
    () =>
      waitForDependencies(['web', 'db'], isBlockReady, {
        now: clock.now,
        sleepFn: clock.sleepFn,
        intervalMs: 100,
        timeoutMs: 500,
      }),
    /dependency wait timed out after 500ms waiting on: web, db/,
  );
});

test('waitForDependencies short-circuits per dependency, not calling isBlockReady for later deps once one fails', async () => {
  const calls = [];
  const isBlockReady = async (name) => {
    calls.push(name);
    return name === 'web';
  };
  const clock = fakeClock();
  await assert.rejects(() =>
    waitForDependencies(['web', 'db'], isBlockReady, {
      now: clock.now,
      sleepFn: clock.sleepFn,
      intervalMs: 100,
      timeoutMs: 100,
    }),
  );
  assert.deepEqual(calls.slice(0, 2), ['web', 'db']);
});

test('waitForHealthCheck resolves immediately true when no healthCheck is declared', async () => {
  const result = await waitForHealthCheck(null);
  assert.equal(result, true);
});

test('waitForHealthCheck polls the probe until it passes, using the healthCheck intervalMs', async () => {
  const clock = fakeClock();
  let calls = 0;
  const probeOptions = { connectFn: () => ({ once: () => {}, removeAllListeners: () => {}, destroy: () => {} }) };
  const result = await waitForHealthCheck(
    { port: 3000, intervalMs: 50 },
    {
      now: clock.now,
      sleepFn: clock.sleepFn,
      timeoutMs: 5000,
      probeOptions: {
        connectFn: () => {
          calls += 1;
          const emitterLike = {
            listeners: {},
            once(event, cb) {
              this.listeners[event] = cb;
            },
            removeAllListeners() {},
            destroy() {},
          };
          setImmediate(() => {
            if (calls >= 3) emitterLike.listeners.connect?.();
            else emitterLike.listeners.error?.(new Error('refused'));
          });
          return emitterLike;
        },
      },
    },
  );
  assert.equal(result, true);
  assert.ok(calls >= 3);
});

test('waitForHealthCheck throws a timeout error including the healthCheck details when it never passes', async () => {
  const clock = fakeClock();
  const probeOptions = {
    connectFn: () => {
      const emitterLike = {
        listeners: {},
        once(event, cb) {
          this.listeners[event] = cb;
        },
        removeAllListeners() {},
        destroy() {},
      };
      setImmediate(() => emitterLike.listeners.error?.(new Error('refused')));
      return emitterLike;
    },
  };
  await assert.rejects(
    () =>
      waitForHealthCheck(
        { port: 3000, intervalMs: 50 },
        { now: clock.now, sleepFn: clock.sleepFn, timeoutMs: 200, probeOptions },
      ),
    /health check timed out after 200ms.*"port":3000/,
  );
});
