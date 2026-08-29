// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetalworksCore } from './Core.js';

function ns(ms) {
  return BigInt(ms) * 1_000_000n;
}

function cpuTimes(user, sys, idle) {
  return [{ model: 'test', speed: 0, times: { user, nice: 0, sys, idle, irq: 0 } }];
}

function cpuTimesSequence(snapshots) {
  let index = 0;
  return () => {
    const snapshot = snapshots[Math.min(index, snapshots.length - 1)];
    index += 1;
    return snapshot;
  };
}

function noTree() {
  return { getChildren: () => [], degraded: false };
}

function baseSampler(overrides = {}) {
  return {
    sampleMemory: async () => ({ totalBytes: 16000, usedBytes: 8000, freeBytes: 8000, degraded: false }),
    sampleProcessTree: async () => noTree(),
    sampleProcessesChunk: async () => new Map(),
    ...overrides,
  };
}

test('Core: the first tick reports null system cpuPercent (no prior snapshot to diff)', async () => {
  const core = createMetalworksCore({
    sampler: baseSampler(),
    getCpuTimes: () => cpuTimes(0, 0, 1000),
    getCoreCount: () => 1,
    platformName: 'linux',
  });
  const tick = await core.produceTick([], ns(0));
  assert.equal(tick.system.cpuPercent, null);
  assert.equal(tick.system.memory.totalBytes, 16000);
  assert.equal(tick.health.systemChannel, 'ok');
});

test('Core: the second tick computes a real system cpuPercent from the os.cpus() delta', async () => {
  const getCpuTimes = cpuTimesSequence([cpuTimes(0, 0, 1000), cpuTimes(500, 0, 1000)]);
  const core = createMetalworksCore({
    sampler: baseSampler(),
    getCpuTimes,
    getCoreCount: () => 1,
    platformName: 'linux',
  });
  await core.produceTick([], ns(0));
  const tick = await core.produceTick([], ns(1000));
  assert.equal(tick.system.cpuPercent, 100);
});

test('Core: a sampleMemory failure serves last-known-good memory tagged with growing age, and eventually degrades the system channel', async () => {
  let shouldFail = false;
  const core = createMetalworksCore({
    sampler: baseSampler({
      sampleMemory: async () => {
        if (shouldFail) throw new Error('vm_stat failed');
        return { totalBytes: 16000, usedBytes: 4000, freeBytes: 12000, degraded: false };
      },
    }),
    getCpuTimes: () => cpuTimes(0, 0, 1000),
    getCoreCount: () => 1,
    systemHealthOptions: { degradeAfterConsecutiveMisses: 2, downAfterMs: 999999 },
  });

  await core.produceTick([], ns(0));
  shouldFail = true;
  const missTick1 = await core.produceTick([], ns(500));
  assert.equal(missTick1.system.memory.totalBytes, 16000);
  assert.equal(missTick1.system.memory.freeBytes, 12000);
  assert.equal(missTick1.system.age, 500);
  assert.equal(missTick1.health.systemChannel, 'ok');

  const missTick2 = await core.produceTick([], ns(1000));
  assert.equal(missTick2.health.systemChannel, 'degraded');
  assert.equal(missTick2.system.age, 1000);
});

test('Core: a degraded memory reading (baseline ok, enrichment failed) still reports fresh baseline numbers, not stale cache', async () => {
  const core = createMetalworksCore({
    sampler: baseSampler({
      sampleMemory: async () => ({ totalBytes: 16000, usedBytes: 5000, freeBytes: 11000, degraded: true }),
    }),
    getCpuTimes: () => cpuTimes(0, 0, 1000),
    getCoreCount: () => 1,
  });
  const tick = await core.produceTick([], ns(0));
  assert.equal(tick.system.memory.freeBytes, 11000);
  assert.equal(tick.system.age, 0);
});

test('Core: zero tracked roots yields an empty perProcess and a healthy channel', async () => {
  const core = createMetalworksCore({ sampler: baseSampler(), getCpuTimes: () => cpuTimes(0, 0, 1000) });
  const tick = await core.produceTick([], ns(0));
  assert.deepEqual(tick.perProcess, {});
  assert.equal(tick.health.perProcessChannel, 'ok');
});

test('Core: sums a tracked root and its whole process tree (npm start wrapper -> real child) into one aggregated entry', async () => {
  const rawByTick = [
    new Map([
      [100, { cpuTimeMs: 0, rssBytes: 2000, alive: true, fingerprint: 'root' }],
      [101, { cpuTimeMs: 0, rssBytes: 1000, alive: true, fingerprint: 'child' }],
    ]),
    new Map([
      [100, { cpuTimeMs: 1000, rssBytes: 2000, alive: true, fingerprint: 'root' }],
      [101, { cpuTimeMs: 500, rssBytes: 1000, alive: true, fingerprint: 'child' }],
    ]),
  ];
  let tickIndex = 0;
  const core = createMetalworksCore({
    sampler: baseSampler({
      sampleProcessTree: async () => ({ getChildren: (pid) => (pid === 100 ? [101] : []), degraded: false }),
      sampleProcessesChunk: async (chunk) => {
        const raw = rawByTick[tickIndex];
        const result = new Map();
        for (const pid of chunk) if (raw.has(pid)) result.set(pid, raw.get(pid));
        return result;
      },
    }),
    getCpuTimes: () => cpuTimes(0, 0, 1000),
    getCoreCount: () => 1,
  });

  const tick1 = await core.produceTick([100], ns(0));
  assert.equal(tick1.perProcess[100].cpuPercent, null);
  assert.equal(tick1.perProcess[100].rssBytes, 3000);

  tickIndex = 1;
  const tick2 = await core.produceTick([100], ns(1000));
  assert.equal(tick2.perProcess[100].cpuPercent, 150);
  assert.equal(tick2.perProcess[100].rssBytes, 3000);
});

test('Core: one hung/failing chunk does not blind other tracked roots (fault isolation)', async () => {
  const core = createMetalworksCore({
    sampler: baseSampler({
      sampleProcessTree: async () => noTree(),
      sampleProcessesChunk: async (chunk) => {
        if (chunk.includes(200)) throw new Error('chunk call failed');
        return new Map([[chunk[0], { cpuTimeMs: 0, rssBytes: 500, alive: true, fingerprint: 'a' }]]);
      },
    }),
    getCpuTimes: () => cpuTimes(0, 0, 1000),
    getCoreCount: () => 1,
    chunkSize: 1,
  });

  const tick = await core.produceTick([100, 200], ns(0));
  assert.equal(tick.perProcess[100].rssBytes, 500);
  assert.equal(tick.perProcess[200].cpuPercent, null);
  assert.equal(tick.perProcess[200].alive, false);
  assert.equal(tick.health.perProcessChannel, 'ok');
});

test('Core: a chunk call that never resolves is treated as a timeout, not a hang', async () => {
  const core = createMetalworksCore({
    sampler: baseSampler({
      sampleProcessTree: async () => noTree(),
      sampleProcessesChunk: async () => new Promise(() => {}),
    }),
    getCpuTimes: () => cpuTimes(0, 0, 1000),
    getCoreCount: () => 1,
    cadenceMs: 20,
  });
  const startedAt = Date.now();
  const tick = await core.produceTick([100], ns(0));
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed < 2000);
  assert.equal(tick.perProcess[100].cpuPercent, null);
});

test('Core: markPerProcessChannelRestricted floors the channel at degraded even when acquisition otherwise succeeds', async () => {
  const core = createMetalworksCore({
    sampler: baseSampler(),
    getCpuTimes: () => cpuTimes(0, 0, 1000),
    getCoreCount: () => 1,
  });
  core.markPerProcessChannelRestricted();
  const tick = await core.produceTick([], ns(0));
  assert.equal(tick.health.perProcessChannel, 'degraded');
});

test('Core: untrackRoot forgets ledger state so re-tracking the same pid starts a fresh first sample', async () => {
  const core = createMetalworksCore({
    sampler: baseSampler({
      sampleProcessesChunk: async (chunk) => new Map(chunk.map((pid) => [pid, { cpuTimeMs: 100, rssBytes: 10, alive: true, fingerprint: 'a' }])),
    }),
    getCpuTimes: () => cpuTimes(0, 0, 1000),
    getCoreCount: () => 1,
  });

  await core.produceTick([100], ns(0));
  const tick2 = await core.produceTick([100], ns(1000));
  assert.notEqual(tick2.perProcess[100].cpuPercent, null);

  core.untrackRoot(100);
  const tick3 = await core.produceTick([100], ns(2000));
  assert.equal(tick3.perProcess[100].cpuPercent, null);
  assert.equal(tick3.perProcess[100].firstSample, true);
});

test('Core: a process-tree acquisition failure degrades the perProcess channel while still reporting the root alone', async () => {
  const core = createMetalworksCore({
    sampler: baseSampler({
      sampleProcessTree: async () => {
        throw new Error('tree lookup failed');
      },
      sampleProcessesChunk: async (chunk) => new Map(chunk.map((pid) => [pid, { cpuTimeMs: 0, rssBytes: 10, alive: true, fingerprint: 'a' }])),
    }),
    getCpuTimes: () => cpuTimes(0, 0, 1000),
    getCoreCount: () => 1,
    processHealthOptions: { degradeAfterConsecutiveMisses: 1 },
  });

  const tick = await core.produceTick([100], ns(0));
  assert.equal(tick.perProcess[100].rssBytes, 10);
  assert.equal(tick.health.perProcessChannel, 'degraded');
});

test('Core: applies the win32 irq correction end-to-end when platformName is win32', async () => {
  function winCpu(user, sys, idle, irq) {
    return [{ model: 'test', speed: 0, times: { user, nice: 0, sys, idle, irq } }];
  }
  const getCpuTimes = cpuTimesSequence([winCpu(0, 0, 0, 0), winCpu(0, 500, 500, 500)]);
  const core = createMetalworksCore({
    sampler: baseSampler(),
    getCpuTimes,
    getCoreCount: () => 1,
    platformName: 'win32',
  });
  await core.produceTick([], ns(0));
  const tick = await core.produceTick([], ns(1000));
  assert.equal(tick.system.cpuPercent, 50);
});

test('Core: getSystemHealthStatus and getProcessHealthStatus expose internal diagnostics', async () => {
  const core = createMetalworksCore({ sampler: baseSampler(), getCpuTimes: () => cpuTimes(0, 0, 1000) });
  await core.produceTick([], ns(0));
  assert.equal(core.getSystemHealthStatus().state, 'ok');
  assert.equal(core.getProcessHealthStatus().state, 'ok');
});

test('Core: consumeEscalations reports a fresh system-channel escalation to down (a sustained blackout), then clears it', async () => {
  const core = createMetalworksCore({
    sampler: baseSampler({
      sampleMemory: async () => {
        throw new Error('vm_stat unavailable');
      },
    }),
    getCpuTimes: () => cpuTimes(0, 0, 1000),
    getCoreCount: () => 1,
    systemHealthOptions: { degradeAfterConsecutiveMisses: 2, downAfterMs: 100 },
  });

  await core.produceTick([], ns(0));
  assert.deepEqual(core.consumeEscalations(), { system: false, process: false });

  await core.produceTick([], ns(200));
  assert.deepEqual(core.consumeEscalations(), { system: true, process: false });

  await core.produceTick([], ns(300));
  assert.deepEqual(core.consumeEscalations(), { system: false, process: false }, 'the escalation flag should have been consumed, not re-fired every subsequent down tick');
});

test('Core: consumeEscalations reports a fresh perProcess-channel escalation to down independently of the system channel', async () => {
  const core = createMetalworksCore({
    sampler: baseSampler({
      sampleProcessesChunk: async () => {
        throw new Error('powershell host down');
      },
    }),
    getCpuTimes: () => cpuTimes(0, 0, 1000),
    getCoreCount: () => 1,
    processHealthOptions: { degradeAfterConsecutiveMisses: 2, downAfterMs: 100 },
  });

  await core.produceTick([100], ns(0));
  await core.produceTick([100], ns(200));
  const escalations = core.consumeEscalations();
  assert.equal(escalations.process, true);
  assert.equal(escalations.system, false);
});
