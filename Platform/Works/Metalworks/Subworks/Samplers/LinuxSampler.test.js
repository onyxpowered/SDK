// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createLinuxSampler } from './LinuxSampler.js';

function fsError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function fakeHandle(getContent) {
  return {
    async read(buffer, offset, length) {
      const content = getContent();
      if (content instanceof Error) throw content;
      const data = Buffer.from(content, 'utf8');
      const bytesRead = Math.min(length, data.length);
      data.copy(buffer, offset, 0, bytesRead);
      return { bytesRead, buffer };
    },
    async close() {},
  };
}

function statLine(pid, { state = 'S', utime = 0, stime = 0, starttime = 111 } = {}) {
  const fields = [state, 1, 100, 100, 0, -1, 4194304, 0, 0, 0, 0, utime, stime, 0, 0, 20, 0, 1, 0, starttime, 0, 0];
  return `${pid} (proc) ${fields.join(' ')}`;
}

function statusContent(rssKb) {
  return `Name:\tproc\nVmRSS:\t   ${rssKb} kB\n`;
}

const MEM_INFO = 'MemTotal:       8000000 kB\nMemFree:        1000000 kB\nMemAvailable:   5000000 kB\nBuffers:         200000 kB\nCached:         1000000 kB\n';

test('LinuxSampler: sampleMemory reads and parses /proc/meminfo with degraded:false', async () => {
  const sampler = createLinuxSampler({
    readFile: async (path) => {
      assert.equal(path, '/proc/meminfo');
      return MEM_INFO;
    },
  });
  const result = await sampler.sampleMemory();
  assert.equal(result.totalBytes, 8000000 * 1024);
  assert.equal(result.freeBytes, 5000000 * 1024);
  assert.equal(result.degraded, false);
});

test('LinuxSampler: sampleMemory propagates a read failure (Core treats it as a system-channel miss)', async () => {
  const sampler = createLinuxSampler({
    readFile: async () => {
      throw fsError('EACCES');
    },
  });
  await assert.rejects(() => sampler.sampleMemory());
});

test('LinuxSampler: sampleProcessesChunk reports cpuTimeMs, rssBytes, alive, and the starttime fingerprint for a live pid', async () => {
  const opened = new Map();
  const sampler = createLinuxSampler({
    open: async (path) => {
      const handle =
        path.endsWith('/stat')
          ? fakeHandle(() => statLine(100, { utime: 250, stime: 50, starttime: 98765 }))
          : fakeHandle(() => statusContent(4200));
      opened.set(path, (opened.get(path) ?? 0) + 1);
      return handle;
    },
  });
  const result = await sampler.sampleProcessesChunk([100]);
  const sample = result.get(100);
  assert.equal(sample.cpuTimeMs, 3000);
  assert.equal(sample.rssBytes, 4200 * 1024);
  assert.equal(sample.alive, true);
  assert.equal(sample.fingerprint, 98765);
});

test('LinuxSampler: caches open file handles across ticks -- open() is called once per pid per file, not every tick', async () => {
  let statOpens = 0;
  let statusOpens = 0;
  const sampler = createLinuxSampler({
    open: async (path) => {
      if (path.endsWith('/stat')) {
        statOpens += 1;
        return fakeHandle(() => statLine(100, { utime: statOpens * 100, starttime: 1 }));
      }
      statusOpens += 1;
      return fakeHandle(() => statusContent(1000));
    },
  });
  await sampler.sampleProcessesChunk([100]);
  await sampler.sampleProcessesChunk([100]);
  await sampler.sampleProcessesChunk([100]);
  assert.equal(statOpens, 1);
  assert.equal(statusOpens, 1);
});

test('LinuxSampler: an ENOENT on the initial open (pid never existed / already gone) reports a confirmed exit, not a miss', async () => {
  const sampler = createLinuxSampler({
    open: async (path) => {
      if (path.endsWith('/stat')) throw fsError('ENOENT');
      return fakeHandle(() => statusContent(0));
    },
  });
  const result = await sampler.sampleProcessesChunk([999]);
  assert.ok(result.has(999));
  assert.equal(result.get(999).alive, false);
});

test('LinuxSampler: an ESRCH while reading an already-cached handle (process exited after the handle was opened) reports a confirmed exit and purges the handle', async () => {
  let openCount = 0;
  let shouldFailRead = false;
  const sampler = createLinuxSampler({
    open: async (path) => {
      if (path.endsWith('/stat')) {
        openCount += 1;
        return fakeHandle(() => (shouldFailRead ? fsError('ESRCH') : statLine(100, { starttime: 1 })));
      }
      return fakeHandle(() => statusContent(1000));
    },
  });

  await sampler.sampleProcessesChunk([100]);
  assert.equal(openCount, 1);

  shouldFailRead = true;
  const result = await sampler.sampleProcessesChunk([100]);
  assert.equal(result.get(100).alive, false);

  shouldFailRead = false;
  await sampler.sampleProcessesChunk([100]);
  assert.equal(openCount, 2);
});

test('LinuxSampler: a transient/permission error (EACCES) leaves the pid absent from the result -- a miss, not a confirmed exit', async () => {
  const sampler = createLinuxSampler({
    open: async (path) => {
      if (path.endsWith('/stat')) throw fsError('EACCES');
      return fakeHandle(() => statusContent(0));
    },
  });
  const result = await sampler.sampleProcessesChunk([100]);
  assert.equal(result.has(100), false);
});

test('LinuxSampler: a zombie (state Z) is reported alive:false, not alive-and-idle', async () => {
  const sampler = createLinuxSampler({
    open: async (path) => {
      if (path.endsWith('/stat')) return fakeHandle(() => statLine(100, { state: 'Z', utime: 10, stime: 10, starttime: 5 }));
      return fakeHandle(() => statusContent(0));
    },
  });
  const result = await sampler.sampleProcessesChunk([100]);
  const sample = result.get(100);
  assert.equal(sample.alive, false);
  assert.equal(sample.fingerprint, 5);
});

test('LinuxSampler: sampleProcessTree resolves children via /proc/[pid]/task/[pid]/children and caches within one call', async () => {
  let reads = 0;
  const sampler = createLinuxSampler({
    readFile: async (path) => {
      reads += 1;
      if (path === '/proc/100/task/100/children') return '101 102\n';
      return '\n';
    },
  });
  const tree = await sampler.sampleProcessTree();
  const childrenFirst = await tree.getChildren(100);
  const childrenSecond = await tree.getChildren(100);
  assert.deepEqual(childrenFirst, [101, 102]);
  assert.deepEqual(childrenSecond, [101, 102]);
  assert.equal(reads, 1);
});

test('LinuxSampler: sampleProcessTree treats a children-file read failure as a leaf (empty children), not a thrown error', async () => {
  const sampler = createLinuxSampler({
    readFile: async () => {
      throw fsError('ENOENT');
    },
  });
  const tree = await sampler.sampleProcessTree();
  const children = await tree.getChildren(999);
  assert.deepEqual(children, []);
  assert.equal(tree.degraded, false);
});

test('LinuxSampler: probeCapability succeeds when the parent pid is readable', async () => {
  const sampler = createLinuxSampler({
    parentPid: 42,
    readFile: async (path) => {
      assert.equal(path, '/proc/42/stat');
      return statLine(42);
    },
  });
  const result = await sampler.probeCapability();
  assert.equal(result.ok, true);
});

test('LinuxSampler: probeCapability reports restricted access with the underlying error code', async () => {
  const sampler = createLinuxSampler({
    parentPid: 42,
    readFile: async () => {
      throw fsError('EACCES');
    },
  });
  const result = await sampler.probeCapability();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'EACCES');
});
