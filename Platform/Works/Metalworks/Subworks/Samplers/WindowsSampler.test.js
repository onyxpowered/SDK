// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createWindowsSampler } from './WindowsSampler.js';
import { createMetalworksCore } from '../Core.js';

function fakeHost({ send = async () => '', probeCapability = async () => ({ ok: true }), getHostState = () => 'ready', stop = () => {} } = {}) {
  return { send, probeCapability, getHostState, stop };
}

test('WindowsSampler: sampleMemory is zero-subprocess -- os.totalmem/freemem only, host.send is never invoked', async () => {
  let sendCalls = 0;
  const host = fakeHost({ send: async () => { sendCalls += 1; return ''; } });
  const sampler = createWindowsSampler({ host, totalMem: () => 16000000000, freeMem: () => 4000000000 });
  const result = await sampler.sampleMemory();
  assert.equal(result.totalBytes, 16000000000);
  assert.equal(result.freeBytes, 4000000000);
  assert.equal(result.usedBytes, 12000000000);
  assert.equal(result.degraded, false);
  assert.equal(sendCalls, 0);
});

test('WindowsSampler: sampleProcessesChunk sends the batched Get-Process template and parses the JSON response', async () => {
  let sentScript = null;
  let sentTimeout = null;
  const host = fakeHost({
    send: async (script, timeoutMs) => {
      sentScript = script;
      sentTimeout = timeoutMs;
      return '[{"Id":100,"CPU":2.5,"WorkingSet64":204800,"StartTime":"a"},{"Id":200,"CPU":1,"WorkingSet64":100,"StartTime":"b"}]';
    },
  });
  const sampler = createWindowsSampler({ host });
  const result = await sampler.sampleProcessesChunk([100, 200], 150);
  assert.match(sentScript, /Get-Process -Id 100,200/);
  assert.equal(sentTimeout, 150);
  assert.equal(result.get(100).cpuTimeMs, 2500);
  assert.equal(result.get(200).rssBytes, 100);
});

test('WindowsSampler: sampleProcessesChunk on an empty chunk returns an empty map without calling host.send', async () => {
  let called = false;
  const host = fakeHost({ send: async () => { called = true; return ''; } });
  const sampler = createWindowsSampler({ host });
  const result = await sampler.sampleProcessesChunk([], 200);
  assert.equal(result.size, 0);
  assert.equal(called, false);
});

test('WindowsSampler: sampleProcessesChunk propagates a host.send rejection (Core treats it as a chunk-level miss)', async () => {
  const host = fakeHost({
    send: async () => {
      throw new Error('powershell host is blocked-by-policy');
    },
  });
  const sampler = createWindowsSampler({ host });
  await assert.rejects(() => sampler.sampleProcessesChunk([100], 200));
});

test('WindowsSampler: sampleProcessesChunk synthesizes a confirmed exit for a requested pid Get-Process silently dropped', async () => {
  const host = fakeHost({ send: async () => '{"Id":100,"CPU":0,"WorkingSet64":0,"StartTime":"a"}' });
  const sampler = createWindowsSampler({ host });
  const result = await sampler.sampleProcessesChunk([100, 999], 200);
  assert.equal(result.get(999).alive, false);
});

test('WindowsSampler: sampleProcessTree sends the Win32_Process snapshot script and builds a getChildren lookup', async () => {
  let sentScript = null;
  const host = fakeHost({
    send: async (script) => {
      sentScript = script;
      return '[{"ProcessId":1,"ParentProcessId":0},{"ProcessId":500,"ParentProcessId":1}]';
    },
  });
  const sampler = createWindowsSampler({ host });
  const tree = await sampler.sampleProcessTree();
  assert.match(sentScript, /Win32_Process/);
  assert.equal(tree.degraded, false);
  assert.deepEqual(tree.getChildren(1), [500]);
});

test('WindowsSampler: sampleProcessTree degrades gracefully when host.send fails (blocked host, timeout, or otherwise)', async () => {
  const host = fakeHost({
    send: async () => {
      throw new Error('powershell command timed out');
    },
  });
  const sampler = createWindowsSampler({ host });
  const tree = await sampler.sampleProcessTree();
  assert.equal(tree.degraded, true);
  assert.deepEqual(tree.getChildren(1), []);
});

test('WindowsSampler: probeCapability, getHostState, and stop delegate directly to the injected host', async () => {
  const calls = { probe: 0, state: 0, stop: 0 };
  const host = fakeHost({
    probeCapability: async () => {
      calls.probe += 1;
      return { ok: true };
    },
    getHostState: () => {
      calls.state += 1;
      return 'ready';
    },
    stop: () => {
      calls.stop += 1;
    },
  });
  const sampler = createWindowsSampler({ host });
  await sampler.probeCapability();
  sampler.getHostState();
  sampler.stop();
  assert.deepEqual(calls, { probe: 1, state: 1, stop: 1 });
});

test('WindowsSampler (end-to-end through Core): a tracked root and its child both surface correctly across two ticks against a realistic fake PowerShell host', async () => {
  const rawByTick = {
    1: '[{"Id":100,"CPU":0,"WorkingSet64":2048,"StartTime":"t1"},{"Id":101,"CPU":0,"WorkingSet64":1024,"StartTime":"t1"}]',
    2: '[{"Id":100,"CPU":1,"WorkingSet64":2048,"StartTime":"t1"},{"Id":101,"CPU":0.5,"WorkingSet64":1024,"StartTime":"t1"}]',
  };
  let tick = 1;
  const host = fakeHost({
    send: async (script) => {
      if (script.includes('Win32_Process')) {
        return '[{"ProcessId":100,"ParentProcessId":1},{"ProcessId":101,"ParentProcessId":100}]';
      }
      return rawByTick[tick];
    },
  });

  const sampler = createWindowsSampler({ host });
  const core = createMetalworksCore({ sampler, getCpuTimes: () => [{ model: 'x', speed: 0, times: { user: 0, nice: 0, sys: 0, idle: 1000, irq: 0 } }], getCoreCount: () => 1 });

  const tick1 = await core.produceTick([100], 0n);
  assert.equal(tick1.perProcess[100].firstSample, true);
  assert.equal(tick1.perProcess[100].rssBytes, 2048 + 1024);

  tick = 2;
  const tick2 = await core.produceTick([100], 1_000_000_000n);
  assert.equal(tick2.perProcess[100].cpuPercent, 150);
  assert.equal(tick2.perProcess[100].rssBytes, 2048 + 1024);
});
