// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runPollWorker } from './PollWorker.js';

const FIXTURE_URL = new URL('./__fixtures__/TestSampler.js', import.meta.url).href;

function fakePort() {
  const port = new EventEmitter();
  port.sent = [];
  port.postMessage = (message) => port.sent.push(message);
  return port;
}

function waitForMessageType(port, type, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const existing = port.sent.find((m) => m.type === type);
    if (existing) {
      resolve(existing);
      return;
    }
    const timer = setTimeout(() => reject(new Error(`timed out waiting for message type ${type}`)), timeoutMs);
    const interval = setInterval(() => {
      const found = port.sent.find((m) => m.type === type);
      if (found) {
        clearInterval(interval);
        clearTimeout(timer);
        resolve(found);
      }
    }, 5);
  });
}

test('PollWorker: posts a ready message and starts producing ticks on schedule', async () => {
  const port = fakePort();
  const { core } = await runPollWorker({ testSamplerModuleUrl: FIXTURE_URL, samplerOptions: {}, cadenceMs: 20 }, port);
  assert.ok(port.sent.some((m) => m.type === 'ready'));

  await waitForMessageType(port, 'tick');
  const ticks = port.sent.filter((m) => m.type === 'tick');
  assert.ok(ticks.length >= 1);
  assert.equal(typeof ticks[0].tick.timestamp, 'bigint');

  port.emit('message', { type: 'stop' });
  void core;
});

test('PollWorker: track() causes subsequent ticks to include the root pid in perProcess', async () => {
  const port = fakePort();
  await runPollWorker({ testSamplerModuleUrl: FIXTURE_URL, samplerOptions: {}, cadenceMs: 15 }, port);
  await waitForMessageType(port, 'ready');

  port.emit('message', { type: 'track', rootPid: 4242 });
  await waitForMessageType(port, 'tick');
  await new Promise((resolve) => setTimeout(resolve, 20));

  const latestTick = port.sent.filter((m) => m.type === 'tick').at(-1);
  assert.ok(Object.prototype.hasOwnProperty.call(latestTick.tick.perProcess, '4242'));

  port.emit('message', { type: 'stop' });
});

test('PollWorker: untrack() removes a root from subsequent ticks', async () => {
  const port = fakePort();
  await runPollWorker(
    { testSamplerModuleUrl: FIXTURE_URL, samplerOptions: {}, cadenceMs: 15, initialTrackedRootPids: [777] },
    port,
  );
  await waitForMessageType(port, 'tick');

  port.emit('message', { type: 'untrack', rootPid: 777 });
  port.sent = port.sent.filter((m) => m.type !== 'tick');
  await waitForMessageType(port, 'tick');

  const latestTick = port.sent.filter((m) => m.type === 'tick').at(-1);
  assert.equal(Object.prototype.hasOwnProperty.call(latestTick.tick.perProcess, '777'), false);

  port.emit('message', { type: 'stop' });
});

test('PollWorker: stop halts further ticks and calls sampler.stop()', async () => {
  const port = fakePort();
  const trackStop = { called: false };
  await runPollWorker({ testSamplerModuleUrl: FIXTURE_URL, samplerOptions: { trackStop }, cadenceMs: 10 }, port);
  await waitForMessageType(port, 'tick');

  port.emit('message', { type: 'stop' });
  await waitForMessageType(port, 'stopped');
  assert.equal(trackStop.called, true);

  const countAtStop = port.sent.filter((m) => m.type === 'tick').length;
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(port.sent.filter((m) => m.type === 'tick').length, countAtStop, 'no further ticks should be produced after stop');
});

test('PollWorker: a failing sampleMemory reports error-free ticks (served last-known-good) without crashing the loop', async () => {
  const port = fakePort();
  await runPollWorker(
    { testSamplerModuleUrl: FIXTURE_URL, samplerOptions: { memoryShouldFail: true }, cadenceMs: 15 },
    port,
  );
  await waitForMessageType(port, 'tick');
  const tick = port.sent.find((m) => m.type === 'tick');
  assert.equal(tick.tick.system.memory.totalBytes, 0);

  port.emit('message', { type: 'stop' });
});

test('PollWorker: a successful startup capability probe posts capability-probe and does not restrict the channel', async () => {
  const port = fakePort();
  await runPollWorker({ testSamplerModuleUrl: FIXTURE_URL, samplerOptions: { probeOk: true }, cadenceMs: 15 }, port);
  const probeMessage = await waitForMessageType(port, 'capability-probe');
  assert.equal(probeMessage.result.ok, true);

  await waitForMessageType(port, 'tick');
  const tick = port.sent.find((m) => m.type === 'tick');
  assert.equal(tick.tick.health.perProcessChannel, 'ok');

  port.emit('message', { type: 'stop' });
});

test('PollWorker: a failed startup capability probe restricts the perProcess channel from the very first tick', async () => {
  const port = fakePort();
  await runPollWorker({ testSamplerModuleUrl: FIXTURE_URL, samplerOptions: { probeOk: false }, cadenceMs: 15 }, port);
  const probeMessage = await waitForMessageType(port, 'capability-probe');
  assert.equal(probeMessage.result.ok, false);

  const tick = await waitForMessageType(port, 'tick');
  assert.notEqual(tick.tick.health.perProcessChannel, 'ok');

  port.emit('message', { type: 'stop' });
});

test('PollWorker: markPerProcessChannelRestricted message forces the channel to at least degraded', async () => {
  const port = fakePort();
  await runPollWorker({ testSamplerModuleUrl: FIXTURE_URL, samplerOptions: {}, cadenceMs: 15 }, port);
  await waitForMessageType(port, 'tick');

  port.emit('message', { type: 'markPerProcessChannelRestricted' });
  port.sent = port.sent.filter((m) => m.type !== 'tick');
  await waitForMessageType(port, 'tick');

  const latestTick = port.sent.filter((m) => m.type === 'tick').at(-1);
  assert.notEqual(latestTick.tick.health.perProcessChannel, 'ok');

  port.emit('message', { type: 'stop' });
});

test('PollWorker: a sustained blackout posts a distinct critical message exactly once at the moment of escalation, not on every subsequent down tick', async () => {
  const port = fakePort();
  await runPollWorker(
    {
      testSamplerModuleUrl: FIXTURE_URL,
      samplerOptions: { memoryShouldFail: true },
      cadenceMs: 10,
      systemHealthOptions: { degradeAfterConsecutiveMisses: 1, downAfterMs: 5 },
    },
    port,
  );

  await waitForMessageType(port, 'critical');
  await new Promise((resolve) => setTimeout(resolve, 60));

  const criticalMessages = port.sent.filter((m) => m.type === 'critical');
  assert.equal(criticalMessages.length, 1, 'the critical escalation should fire exactly once, not on every tick the channel stays down');
  assert.equal(criticalMessages[0].escalations.system, true);
  assert.equal(criticalMessages[0].health.systemChannel, 'down');

  port.emit('message', { type: 'stop' });
});
