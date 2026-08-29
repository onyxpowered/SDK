// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePsLine, parseCpuTimeToMs, isZombieStat, parsePidPpidLine, parseVmStat, parsePressureLevel } from './PsParse.js';

test('PsParse: parsePsLine extracts pid, stat, rss, time, and the multi-token lstart fingerprint from a real ps -o line', () => {
  const line = '60324 Ss     3056   0:00.02 Tue Aug 18 17:28:31 2026';
  const result = parsePsLine(line);
  assert.equal(result.pid, 60324);
  assert.equal(result.stat, 'Ss');
  assert.equal(result.rssKb, 3056);
  assert.equal(result.time, '0:00.02');
  assert.equal(result.lstart, 'Tue Aug 18 17:28:31 2026');
});

test('PsParse: parsePsLine tolerates the trailing whitespace macOS ps sometimes emits', () => {
  const line = '    1 Ss    13904  26:05.14 Sat Aug 15 23:49:34 2026    ';
  const result = parsePsLine(line);
  assert.equal(result.pid, 1);
  assert.equal(result.lstart, 'Sat Aug 15 23:49:34 2026');
});

test('PsParse: parsePsLine returns null for a blank line', () => {
  assert.equal(parsePsLine(''), null);
  assert.equal(parsePsLine('   '), null);
});

test('PsParse: parseCpuTimeToMs handles the common M:SS.cc form', () => {
  assert.equal(parseCpuTimeToMs('0:00.02'), 20);
  assert.equal(parseCpuTimeToMs('1:02.50'), 62500);
});

test('PsParse: parseCpuTimeToMs handles minutes exceeding 59 without switching to an hours field (real WindowServer-style value)', () => {
  assert.equal(parseCpuTimeToMs('397:51.65'), (397 * 60 + 51.65) * 1000);
});

test('PsParse: parseCpuTimeToMs handles a defensive H:MM:SS.cc form if macOS ps ever emits one', () => {
  assert.equal(parseCpuTimeToMs('1:02:03.45'), (1 * 3600 + 2 * 60 + 3.45) * 1000);
});

test('PsParse: isZombieStat recognizes a Z-prefixed stat column and nothing else', () => {
  assert.equal(isZombieStat('Z'), true);
  assert.equal(isZombieStat('Z+'), true);
  assert.equal(isZombieStat('Ss'), false);
  assert.equal(isZombieStat('R+'), false);
});

test('PsParse: parsePidPpidLine parses a system-wide ps -A -o pid=,ppid= line', () => {
  assert.deepEqual(parsePidPpidLine('  339     1'), { pid: 339, ppid: 1 });
});

test('PsParse: parsePidPpidLine returns null for a blank line', () => {
  assert.equal(parsePidPpidLine(''), null);
});

const REAL_VM_STAT_OUTPUT = [
  'Mach Virtual Memory Statistics: (page size of 16384 bytes)',
  'Pages free:                                     4718.',
  'Pages active:                                 221798.',
  'Pages inactive:                               220465.',
  'Pages speculative:                              1704.',
  'Pages throttled:                                   0.',
  'Pages wired down:                             149559.',
  'Pages purgeable:                                5279.',
  '"Translation faults":                      539946002.',
  'Pages copy-on-write:                        14559666.',
  'Pages zero filled:                        1091622421.',
  'Pages reactivated:                         121463207.',
  'Pages purged:                               37753058.',
  'File-backed pages:                            139505.',
  'Anonymous pages:                              304462.',
  'Pages stored in compressor:                   742642.',
  'Pages occupied by compressor:                 413657.',
  'Decompressions:                            101717983.',
  'Compressions:                              126729712.',
  'Pageins:                                    29713717.',
  'Pageouts:                                     203746.',
  'Swapins:                                      580959.',
  'Swapouts:                                    1095070.',
  '',
].join('\n');

test('PsParse: parseVmStat reads the real page size out of the header line (Apple Silicon uses 16384, not the Intel 4096 default)', () => {
  const result = parseVmStat(REAL_VM_STAT_OUTPUT);
  assert.equal(result.pageSize, 16384);
});

test('PsParse: parseVmStat extracts free, speculative, and purgeable page counts from real vm_stat output', () => {
  const result = parseVmStat(REAL_VM_STAT_OUTPUT);
  assert.equal(result.freePages, 4718);
  assert.equal(result.speculativePages, 1704);
  assert.equal(result.purgeablePages, 5279);
});

test('PsParse: parseVmStat is not confused by a quoted key sharing the same line shape ("Translation faults")', () => {
  const result = parseVmStat(REAL_VM_STAT_OUTPUT);
  assert.equal(result.freePages, 4718);
});

test('PsParse: parseVmStat falls back to the standard 4096 page size if the header is unparseable', () => {
  const result = parseVmStat('unexpected output\n');
  assert.equal(result.pageSize, 4096);
  assert.equal(result.freePages, 0);
});

test('PsParse: parsePressureLevel parses the bare integer sysctl prints', () => {
  assert.equal(parsePressureLevel('2\n'), 2);
  assert.equal(parsePressureLevel('1'), 1);
});

test('PsParse: parsePressureLevel returns null for unparseable output', () => {
  assert.equal(parsePressureLevel('not a number'), null);
});
