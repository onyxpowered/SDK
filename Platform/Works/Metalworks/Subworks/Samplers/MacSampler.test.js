// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createMacSampler } from './MacSampler.js';
import { createMetalworksCore } from '../Core.js';

const REAL_VM_STAT_OUTPUT = [
  'Mach Virtual Memory Statistics: (page size of 16384 bytes)',
  'Pages free:                                     4718.',
  'Pages speculative:                              1704.',
  'Pages purgeable:                                5279.',
  'Pages wired down:                             149559.',
  '',
].join('\n');

function fakeExec(router) {
  return async (cmd, args, options) => router(cmd, args, options);
}

test('MacSampler: sampleMemory computes availableBytes from free+speculative+purgeable pages at the real page size (enrichment ok)', async () => {
  const sampler = createMacSampler({
    execFileImpl: fakeExec((cmd) => {
      if (cmd === 'vm_stat') return { stdout: REAL_VM_STAT_OUTPUT };
      if (cmd === 'sysctl') return { stdout: '1\n' };
      throw new Error(`unexpected command ${cmd}`);
    }),
    totalMem: () => 16000000000,
    freeMem: () => 500000000,
  });
  const result = await sampler.sampleMemory();
  assert.equal(result.degraded, false);
  assert.equal(result.totalBytes, 16000000000);
  assert.equal(result.freeBytes, (4718 + 1704 + 5279) * 16384);
});

test('MacSampler: sampleMemory falls back to the always-live os.totalmem/freemem baseline when vm_stat fails (degraded:true, not fully dark)', async () => {
  const sampler = createMacSampler({
    execFileImpl: fakeExec((cmd) => {
      if (cmd === 'vm_stat') throw new Error('vm_stat unavailable');
      return { stdout: '1\n' };
    }),
    totalMem: () => 16000000000,
    freeMem: () => 500000000,
  });
  const result = await sampler.sampleMemory();
  assert.equal(result.degraded, true);
  assert.equal(result.totalBytes, 16000000000);
  assert.equal(result.freeBytes, 500000000);
  assert.equal(result.usedBytes, 16000000000 - 500000000);
});

test('MacSampler: sampleProcessesChunk parses a batched ps response into per-pid raw samples', async () => {
  const sampler = createMacSampler({
    execFileImpl: fakeExec((cmd, args) => {
      assert.equal(cmd, 'ps');
      assert.deepEqual(args, ['-p', '100,101', '-o', 'pid=,stat=,rss=,time=,lstart=']);
      return {
        stdout: ['100 Ss     2048   0:01.50 Tue Aug 18 10:00:00 2026', '101 R+    4096   0:00.25 Tue Aug 18 10:00:01 2026', ''].join('\n'),
      };
    }),
  });
  const result = await sampler.sampleProcessesChunk([100, 101], 200);
  assert.equal(result.get(100).cpuTimeMs, 1500);
  assert.equal(result.get(100).rssBytes, 2048 * 1024);
  assert.equal(result.get(100).alive, true);
  assert.equal(result.get(100).fingerprint, 'Tue Aug 18 10:00:00 2026');
  assert.equal(result.get(101).cpuTimeMs, 250);
});

test('MacSampler: sampleProcessesChunk marks a zombie (stat Z) alive:false with a zeroed rss', async () => {
  const sampler = createMacSampler({
    execFileImpl: fakeExec(() => ({
      stdout: '100 Z      0      0:00.00 Tue Aug 18 10:00:00 2026\n',
    })),
  });
  const result = await sampler.sampleProcessesChunk([100], 200);
  assert.equal(result.get(100).alive, false);
  assert.equal(result.get(100).rssBytes, 0);
});

test('MacSampler: sampleProcessesChunk reports a pid absent from an otherwise-successful ps response as a confirmed exit', async () => {
  const sampler = createMacSampler({
    execFileImpl: fakeExec(() => ({
      stdout: '100 Ss   2048   0:01.00 Tue Aug 18 10:00:00 2026\n',
    })),
  });
  const result = await sampler.sampleProcessesChunk([100, 999], 200);
  assert.equal(result.get(999).alive, false);
  assert.equal(result.get(999).rssBytes, null);
});

test('MacSampler: sampleProcessesChunk on an empty chunk returns an empty map without invoking ps', async () => {
  let called = false;
  const sampler = createMacSampler({ execFileImpl: fakeExec(() => { called = true; return { stdout: '' }; }) });
  const result = await sampler.sampleProcessesChunk([], 200);
  assert.equal(result.size, 0);
  assert.equal(called, false);
});

test('MacSampler: sampleProcessesChunk propagates a whole-call failure (Core treats it as a chunk-level miss)', async () => {
  const sampler = createMacSampler({
    execFileImpl: fakeExec(() => {
      throw new Error('ps failed');
    }),
  });
  await assert.rejects(() => sampler.sampleProcessesChunk([100], 200));
});

test('MacSampler: sampleProcessesChunk passes the Core-computed deadline through as the execFile timeout option', async () => {
  let receivedOptions = null;
  const sampler = createMacSampler({
    execFileImpl: fakeExec((cmd, args, options) => {
      receivedOptions = options;
      return { stdout: '' };
    }),
  });
  await sampler.sampleProcessesChunk([100], 130);
  assert.equal(receivedOptions.timeout, 130);
});

test('MacSampler: sampleProcessTree builds a getChildren lookup from a system-wide ps -A -o pid=,ppid= snapshot', async () => {
  const sampler = createMacSampler({
    execFileImpl: fakeExec((cmd, args) => {
      assert.deepEqual(args, ['-A', '-o', 'pid=,ppid=']);
      return { stdout: ['1 0', '339 1', '500 339', ''].join('\n') };
    }),
  });
  const tree = await sampler.sampleProcessTree();
  assert.equal(tree.degraded, false);
  assert.deepEqual(tree.getChildren(339), [500]);
});

test('MacSampler: sampleProcessTree degrades gracefully (empty children, degraded:true) when the system-wide ps call fails', async () => {
  const sampler = createMacSampler({
    execFileImpl: fakeExec(() => {
      throw new Error('ps failed');
    }),
  });
  const tree = await sampler.sampleProcessTree();
  assert.equal(tree.degraded, true);
  assert.deepEqual(tree.getChildren(1), []);
});

test('MacSampler (real, live): sampleMemory against the real vm_stat/sysctl/os.totalmem on this machine returns sane numbers', async () => {
  const sampler = createMacSampler();
  const result = await sampler.sampleMemory();
  assert.equal(typeof result.degraded, 'boolean');
  assert.ok(result.totalBytes > 0);
  assert.ok(result.freeBytes >= 0);
  assert.ok(result.freeBytes <= result.totalBytes);
});

test('MacSampler (real, live): sampleProcessesChunk against the real ps on this machine samples this very test process', async () => {
  const sampler = createMacSampler();
  const result = await sampler.sampleProcessesChunk([process.pid], 500);
  const sample = result.get(process.pid);
  assert.equal(sample.alive, true);
  assert.ok(sample.rssBytes > 0);
  assert.ok(sample.cpuTimeMs >= 0);
  assert.equal(typeof sample.fingerprint, 'string');
  assert.ok(sample.fingerprint.length > 0);
});

test('MacSampler (real, live): sampleProcessTree finds a real spawned child process under this test process', async (t) => {
  const child = spawn('sleep', ['5']);
  t.after(() => {
    child.kill();
  });
  await new Promise((resolve) => setTimeout(resolve, 400));

  const sampler = createMacSampler();
  const tree = await sampler.sampleProcessTree();
  const children = await tree.getChildren(process.pid);
  assert.ok(children.includes(child.pid), `expected ${process.pid}'s children ${children} to include spawned pid ${child.pid}`);
});

test('MacSampler (real, live, end-to-end through Core): tracking a real spawned child root across two ticks yields null then a real cpuPercent', async (t) => {
  const child = spawn('node', ['-e', 'let x = 0; setInterval(() => { for (let i = 0; i < 2e7; i++) x += i; }, 50);']);
  t.after(() => {
    child.kill();
  });
  await new Promise((resolve) => setTimeout(resolve, 300));

  const core = createMetalworksCore({ sampler: createMacSampler(), cadenceMs: 300 });
  const tick1 = await core.produceTick([child.pid], process.hrtime.bigint());
  assert.equal(tick1.perProcess[child.pid].firstSample, true);
  assert.equal(tick1.perProcess[child.pid].alive, true);

  await new Promise((resolve) => setTimeout(resolve, 400));
  const tick2 = await core.produceTick([child.pid], process.hrtime.bigint());
  assert.equal(tick2.perProcess[child.pid].alive, true);
  assert.notEqual(tick2.perProcess[child.pid].cpuPercent, null);
  assert.ok(tick2.perProcess[child.pid].cpuPercent >= 0);
});
