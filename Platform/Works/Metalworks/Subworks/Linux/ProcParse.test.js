// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStat,
  parseStatusRssBytes,
  parseMemInfo,
  parseChildrenList,
  isZombieState,
  LINUX_CLOCK_TICKS_PER_SECOND,
} from './ProcParse.js';

function buildStatLine(pid, comm, { state = 'S', ppid = 1, utime = 0, stime = 0, starttime = 0 } = {}) {
  const fields = [
    state, ppid, 100, 100, 0, -1, 4194304, 0, 0, 0, 0,
    utime, stime,
    0, 0,
    20, 0, 1, 0,
    starttime,
    123456, 4321,
  ];
  return `${pid} (${comm}) ${fields.join(' ')}`;
}

test('ProcParse: LINUX_CLOCK_TICKS_PER_SECOND is the standard USER_HZ value', () => {
  assert.equal(LINUX_CLOCK_TICKS_PER_SECOND, 100);
});

test('ProcParse: parseStat extracts pid, comm, state, ppid, cpu time, and the starttime fingerprint field', () => {
  const line = buildStatLine(1234, 'bash', { state: 'S', ppid: 1, utime: 250, stime: 50, starttime: 98765 });
  const result = parseStat(line);
  assert.equal(result.pid, 1234);
  assert.equal(result.comm, 'bash');
  assert.equal(result.state, 'S');
  assert.equal(result.ppid, 1);
  assert.equal(result.cpuTimeMs, 3000);
  assert.equal(result.starttimeTicks, 98765);
});

test('ProcParse: parseStat correctly isolates a comm field that itself contains parentheses (the vendored-code bug this fixes)', () => {
  const line = buildStatLine(555, 'foo (bar)', { utime: 10, stime: 10, starttime: 1 });
  const result = parseStat(line);
  assert.equal(result.pid, 555);
  assert.equal(result.comm, 'foo (bar)');
  assert.equal(result.cpuTimeMs, 200);
});

test('ProcParse: parseStat handles a comm field containing spaces and a trailing paren (retitled Electron/Chromium helper style)', () => {
  const line = buildStatLine(777, 'Helper (Renderer)', { utime: 0, stime: 0, starttime: 5 });
  const result = parseStat(line);
  assert.equal(result.comm, 'Helper (Renderer)');
});

test('ProcParse: parseStat throws on content with no parenthesized comm field', () => {
  assert.throws(() => parseStat('not a real stat line'), /malformed/);
});

test('ProcParse: isZombieState recognizes the Z state and nothing else', () => {
  assert.equal(isZombieState('Z'), true);
  assert.equal(isZombieState('S'), false);
  assert.equal(isZombieState('R'), false);
});

test('ProcParse: parseStatusRssBytes converts VmRSS from kB to bytes out of a realistic /proc/[pid]/status blob', () => {
  const content = [
    'Name:\tbash',
    'State:\tS (sleeping)',
    'Pid:\t1234',
    'VmPeak:\t   21568 kB',
    'VmRSS:\t    4200 kB',
    'VmData:\t   3000 kB',
    '',
  ].join('\n');
  assert.equal(parseStatusRssBytes(content), 4200 * 1024);
});

test('ProcParse: parseStatusRssBytes returns null when VmRSS is absent', () => {
  assert.equal(parseStatusRssBytes('Name:\tbash\nPid:\t1234\n'), null);
});

test('ProcParse: parseMemInfo prefers MemAvailable when present (modern kernel)', () => {
  const content = ['MemTotal:       16000000 kB', 'MemFree:         2000000 kB', 'MemAvailable:    9000000 kB', 'Buffers:          500000 kB', 'Cached:          3000000 kB', ''].join(
    '\n',
  );
  const result = parseMemInfo(content);
  assert.equal(result.totalBytes, 16000000 * 1024);
  assert.equal(result.freeBytes, 9000000 * 1024);
  assert.equal(result.usedBytes, (16000000 - 9000000) * 1024);
});

test('ProcParse: parseMemInfo falls back to MemFree+Buffers+Cached when MemAvailable is absent (pre-3.14 kernel)', () => {
  const content = ['MemTotal:       16000000 kB', 'MemFree:         2000000 kB', 'Buffers:          500000 kB', 'Cached:          3000000 kB', ''].join('\n');
  const result = parseMemInfo(content);
  assert.equal(result.totalBytes, 16000000 * 1024);
  assert.equal(result.freeBytes, (2000000 + 500000 + 3000000) * 1024);
});

test('ProcParse: parseChildrenList parses a space-separated pid list from /proc/[pid]/task/[pid]/children', () => {
  assert.deepEqual(parseChildrenList('101 102 103\n'), [101, 102, 103]);
});

test('ProcParse: parseChildrenList returns an empty array for a leaf process (no children)', () => {
  assert.deepEqual(parseChildrenList('\n'), []);
  assert.deepEqual(parseChildrenList(''), []);
});

test('ProcParse: parseChildrenList tolerates extra whitespace', () => {
  assert.deepEqual(parseChildrenList('  101   102  '), [101, 102]);
});
