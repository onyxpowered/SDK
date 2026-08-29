// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetalworks, VERSION } from './Metalworks.js';
import { REQUIRED_VERSIONS } from '../Systemworks/Subworks/RequiredVersions.js';

const WORKER_URL = new URL('./Subworks/Worker/PollWorker.js', import.meta.url);
const FIXTURE_URL = new URL('./Subworks/Worker/__fixtures__/TestSampler.js', import.meta.url).href;

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

test('Metalworks: VERSION matches the exact-match version Platform.boot expects via REQUIRED_VERSIONS', () => {
  assert.equal(VERSION, REQUIRED_VERSIONS.Metalworks);
});

test('Metalworks: getLatestTick is null before the first real tick arrives, then holds the most recent one', async (t) => {
  const metalworks = createMetalworks({
    workerUrl: WORKER_URL,
    testSamplerModuleUrl: FIXTURE_URL,
    samplerOptions: {},
    cadenceMs: 20,
  });
  t.after(() => metalworks.stop());

  assert.equal(metalworks.getLatestTick(), null);
  await metalworks.whenReady();
  await waitFor(() => metalworks.getLatestTick() !== null);

  const tick = metalworks.getLatestTick();
  assert.equal(typeof tick.timestamp, 'bigint');
  assert.ok(['ok', 'degraded', 'down'].includes(tick.health.systemChannel));
});

test('Metalworks: track/untrack reach the real worker and change subsequent ticks', async (t) => {
  const metalworks = createMetalworks({
    workerUrl: WORKER_URL,
    testSamplerModuleUrl: FIXTURE_URL,
    samplerOptions: {},
    cadenceMs: 20,
  });
  t.after(() => metalworks.stop());
  await metalworks.whenReady();

  metalworks.track(31337);
  await waitFor(() => {
    const tick = metalworks.getLatestTick();
    return tick !== null && Object.prototype.hasOwnProperty.call(tick.perProcess, '31337');
  });
  assert.equal(metalworks.getLatestTick().perProcess['31337'].alive, true);

  metalworks.untrack(31337);
  let sawWithout = false;
  await waitFor(() => {
    const tick = metalworks.getLatestTick();
    if (tick && !Object.prototype.hasOwnProperty.call(tick.perProcess, '31337')) {
      sawWithout = true;
    }
    return sawWithout;
  });
  assert.equal(sawWithout, true);
});

test('Metalworks: stop() cleanly tears down the underlying worker', async () => {
  const metalworks = createMetalworks({
    workerUrl: WORKER_URL,
    testSamplerModuleUrl: FIXTURE_URL,
    samplerOptions: {},
    cadenceMs: 20,
  });
  await metalworks.whenReady();
  await metalworks.stop();
});

test('Metalworks: onError and onCapabilityProbe are wired straight through to the worker host', async (t) => {
  const metalworks = createMetalworks({
    workerUrl: WORKER_URL,
    testSamplerModuleUrl: FIXTURE_URL,
    samplerOptions: { probeOk: false },
    cadenceMs: 20,
  });
  t.after(() => metalworks.stop());

  let probeResult = null;
  metalworks.onCapabilityProbe((result) => {
    probeResult = result;
  });
  await waitFor(() => probeResult !== null);
  assert.equal(probeResult.ok, false);
});

test('Metalworks: onCritical surfaces a sustained blackout loudly -- Plan.txt section 7\'s "fail loud, not only to Blockworks" requirement', async (t) => {
  const metalworks = createMetalworks({
    workerUrl: WORKER_URL,
    testSamplerModuleUrl: FIXTURE_URL,
    samplerOptions: { memoryShouldFail: true },
    cadenceMs: 10,
    systemHealthOptions: { degradeAfterConsecutiveMisses: 1, downAfterMs: 5 },
  });
  t.after(() => metalworks.stop());

  let critical = null;
  metalworks.onCritical((event) => {
    critical = event;
  });
  await waitFor(() => critical !== null);
  assert.equal(critical.health.systemChannel, 'down');
});
