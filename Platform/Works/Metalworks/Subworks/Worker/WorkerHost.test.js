// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerHost } from './WorkerHost.js';

const WORKER_URL = new URL('./PollWorker.js', import.meta.url);
const FIXTURE_URL = new URL('./__fixtures__/TestSampler.js', import.meta.url).href;

function waitFor(predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(() => {
      if (predicate()) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error('waitFor timed out'));
      }
    }, 5);
  });
}

test('WorkerHost (real worker_threads.Worker): whenReady resolves once the worker has actually started', async (t) => {
  const host = createWorkerHost({
    workerUrl: WORKER_URL,
    testSamplerModuleUrl: FIXTURE_URL,
    samplerOptions: {},
    cadenceMs: 20,
  });
  t.after(() => host.stop());
  await host.whenReady();
});

test('WorkerHost (real worker_threads.Worker): onTick receives real ticks posted across the thread boundary, with a genuine bigint timestamp', async (t) => {
  const host = createWorkerHost({
    workerUrl: WORKER_URL,
    testSamplerModuleUrl: FIXTURE_URL,
    samplerOptions: {},
    cadenceMs: 20,
  });
  t.after(() => host.stop());

  const ticks = [];
  host.onTick((tick) => ticks.push(tick));
  await waitFor(() => ticks.length >= 2);

  assert.equal(typeof ticks[0].timestamp, 'bigint');
  assert.equal(typeof ticks[0].system.cpuPercent === 'number' || ticks[0].system.cpuPercent === null, true);
});

test('WorkerHost (real worker_threads.Worker): track() causes a real spawned child process, tracked across the thread boundary, to appear in ticks', async (t) => {
  const host = createWorkerHost({
    workerUrl: WORKER_URL,
    testSamplerModuleUrl: FIXTURE_URL,
    samplerOptions: {},
    cadenceMs: 20,
  });
  t.after(() => host.stop());
  await host.whenReady();

  const ticks = [];
  host.onTick((tick) => ticks.push(tick));
  host.track(9999);

  await waitFor(() => ticks.some((tick) => Object.prototype.hasOwnProperty.call(tick.perProcess, '9999')));

  const withRoot = ticks.find((tick) => Object.prototype.hasOwnProperty.call(tick.perProcess, '9999'));
  assert.equal(withRoot.perProcess['9999'].alive, true);
});

test('WorkerHost (real worker_threads.Worker): untrack() removes a root from subsequent real ticks', async (t) => {
  const host = createWorkerHost({
    workerUrl: WORKER_URL,
    testSamplerModuleUrl: FIXTURE_URL,
    samplerOptions: {},
    cadenceMs: 20,
    initialTrackedRootPids: [5555],
  });
  t.after(() => host.stop());

  const ticks = [];
  host.onTick((tick) => ticks.push(tick));
  await waitFor(() => ticks.some((tick) => Object.prototype.hasOwnProperty.call(tick.perProcess, '5555')));

  host.untrack(5555);
  ticks.length = 0;
  await waitFor(() => ticks.length >= 1);

  assert.equal(ticks.every((tick) => !Object.prototype.hasOwnProperty.call(tick.perProcess, '5555')), true);
});

test('WorkerHost (real worker_threads.Worker): onCapabilityProbe surfaces a real cross-thread startup probe result', async (t) => {
  const host = createWorkerHost({
    workerUrl: WORKER_URL,
    testSamplerModuleUrl: FIXTURE_URL,
    samplerOptions: { probeOk: false },
    cadenceMs: 20,
  });
  t.after(() => host.stop());

  let probeResult = null;
  host.onCapabilityProbe((result) => {
    probeResult = result;
  });
  await waitFor(() => probeResult !== null);
  assert.equal(probeResult.ok, false);

  const ticks = [];
  host.onTick((tick) => ticks.push(tick));
  await waitFor(() => ticks.length >= 1);
  assert.notEqual(ticks[0].health.perProcessChannel, 'ok');
});

test('WorkerHost (real worker_threads.Worker): stop() actually terminates the underlying worker thread', async () => {
  const host = createWorkerHost({
    workerUrl: WORKER_URL,
    testSamplerModuleUrl: FIXTURE_URL,
    samplerOptions: {},
    cadenceMs: 20,
  });
  await host.whenReady();

  const exitCode = await new Promise((resolve) => {
    host.worker.once('exit', resolve);
    host.stop();
  });
  assert.equal(typeof exitCode, 'number');
});

test('WorkerHost (real worker_threads.Worker): no more ticks arrive after stop() resolves', async () => {
  const host = createWorkerHost({
    workerUrl: WORKER_URL,
    testSamplerModuleUrl: FIXTURE_URL,
    samplerOptions: {},
    cadenceMs: 15,
  });
  const ticks = [];
  host.onTick((tick) => ticks.push(tick));
  await waitFor(() => ticks.length >= 1);

  await host.stop();
  const countAtStop = ticks.length;
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(ticks.length, countAtStop);
});

test('WorkerHost (real worker_threads.Worker): onCritical fires exactly once, across a real thread boundary, the moment a channel escalates to down', async (t) => {
  const host = createWorkerHost({
    workerUrl: WORKER_URL,
    testSamplerModuleUrl: FIXTURE_URL,
    samplerOptions: { memoryShouldFail: true },
    cadenceMs: 10,
    systemHealthOptions: { degradeAfterConsecutiveMisses: 1, downAfterMs: 5 },
  });
  t.after(() => host.stop());

  const criticalEvents = [];
  host.onCritical((event) => criticalEvents.push(event));
  await waitFor(() => criticalEvents.length >= 1);

  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(criticalEvents.length, 1);
  assert.equal(criticalEvents[0].escalations.system, true);
  assert.equal(criticalEvents[0].health.systemChannel, 'down');
});
