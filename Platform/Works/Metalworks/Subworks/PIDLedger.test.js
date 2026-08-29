// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createPidLedger, DEFAULT_STALE_AFTER_MS } from './PIDLedger.js';

function ns(ms) {
  return BigInt(ms) * 1_000_000n;
}

test('PIDLedger: the first successful sample for a pid returns cpuPercent null and firstSample true', () => {
  const ledger = createPidLedger({ coreCount: 4 });
  const sample = ledger.recordSample(100, { cpuTimeMs: 500, rssBytes: 2048, alive: true, fingerprint: 'fp-a' }, ns(0));
  assert.equal(sample.cpuPercent, null);
  assert.equal(sample.firstSample, true);
  assert.equal(sample.alive, true);
  assert.equal(sample.rssBytes, 2048);
});

test('PIDLedger: the second sample computes a real cpuPercent and firstSample flips to false', () => {
  const ledger = createPidLedger({ coreCount: 4 });
  ledger.recordSample(100, { cpuTimeMs: 0, rssBytes: 1000, alive: true, fingerprint: 'fp-a' }, ns(0));
  const sample = ledger.recordSample(100, { cpuTimeMs: 1000, rssBytes: 1200, alive: true, fingerprint: 'fp-a' }, ns(1000));
  assert.equal(sample.firstSample, false);
  assert.equal(sample.cpuPercent, 25);
  assert.equal(sample.rssBytes, 1200);
});

test('PIDLedger: a third sample computes cpuPercent from the delta since the second sample, not since the first', () => {
  const ledger = createPidLedger({ coreCount: 1 });
  ledger.recordSample(100, { cpuTimeMs: 0, rssBytes: 1000, alive: true, fingerprint: 'fp-a' }, ns(0));
  ledger.recordSample(100, { cpuTimeMs: 1000, rssBytes: 1000, alive: true, fingerprint: 'fp-a' }, ns(1000));
  const sample = ledger.recordSample(100, { cpuTimeMs: 1100, rssBytes: 1000, alive: true, fingerprint: 'fp-a' }, ns(2000));
  assert.equal(sample.cpuPercent, 10);
});

test('PIDLedger: a miss on a pid never sampled returns the unknown sentinel (null cpu/rss, stale, alive false)', () => {
  const ledger = createPidLedger();
  const sample = ledger.recordMiss(999, ns(0));
  assert.equal(sample.cpuPercent, null);
  assert.equal(sample.rssBytes, null);
  assert.equal(sample.alive, false);
  assert.equal(sample.firstSample, true);
  assert.equal(sample.stale, true);
});

test('PIDLedger: a miss after a good sample serves last-known-good tagged with its growing age', () => {
  const ledger = createPidLedger({ coreCount: 4, staleAfterMs: 5000 });
  ledger.recordSample(100, { cpuTimeMs: 0, rssBytes: 1000, alive: true, fingerprint: 'fp-a' }, ns(0));
  ledger.recordSample(100, { cpuTimeMs: 1000, rssBytes: 1200, alive: true, fingerprint: 'fp-a' }, ns(1000));
  const missSample = ledger.recordMiss(100, ns(1500));
  assert.equal(missSample.cpuPercent, 25);
  assert.equal(missSample.rssBytes, 1200);
  assert.equal(missSample.alive, true);
  assert.equal(missSample.ageMs, 500);
  assert.equal(missSample.stale, false);
});

test('PIDLedger: staleAfterMs threshold flips the stale flag once age exceeds it', () => {
  const ledger = createPidLedger({ coreCount: 4, staleAfterMs: 1000 });
  ledger.recordSample(100, { cpuTimeMs: 0, rssBytes: 1000, alive: true, fingerprint: 'fp-a' }, ns(0));
  const justUnder = ledger.recordMiss(100, ns(999));
  assert.equal(justUnder.stale, false);
  const justOver = ledger.recordMiss(100, ns(1001));
  assert.equal(justOver.stale, true);
});

test('PIDLedger: defaults staleAfterMs to a sane sub-second-to-low-seconds value', () => {
  assert.ok(DEFAULT_STALE_AFTER_MS > 0 && DEFAULT_STALE_AFTER_MS < 10000);
});

test('PIDLedger: an explicit alive:false raw sample (zombie/confirmed exit) marks the pid terminal', () => {
  const ledger = createPidLedger({ coreCount: 4 });
  ledger.recordSample(100, { cpuTimeMs: 0, rssBytes: 1000, alive: true, fingerprint: 'fp-a' }, ns(0));
  const sample = ledger.recordSample(100, { cpuTimeMs: 0, rssBytes: 0, alive: false, fingerprint: 'fp-a' }, ns(1000));
  assert.equal(sample.alive, false);
  assert.equal(sample.cpuPercent, null);
  assert.equal(ledger.isTerminal(100), true);
});

test('PIDLedger: a terminal pid stays frozen on subsequent samples and misses, regardless of new raw data', () => {
  const ledger = createPidLedger({ coreCount: 4 });
  ledger.recordSample(100, { cpuTimeMs: 0, rssBytes: 1000, alive: true, fingerprint: 'fp-a' }, ns(0));
  ledger.recordSample(100, { cpuTimeMs: 0, rssBytes: 0, alive: false, fingerprint: 'fp-a' }, ns(1000));
  const afterMiss = ledger.recordMiss(100, ns(2000));
  assert.equal(afterMiss.alive, false);
  const afterAnotherSample = ledger.recordSample(
    100,
    { cpuTimeMs: 5000, rssBytes: 9999, alive: true, fingerprint: 'fp-a' },
    ns(3000),
  );
  assert.equal(afterAnotherSample.alive, false);
  assert.equal(afterAnotherSample.cpuPercent, null);
});

test('PIDLedger: a fingerprint mismatch (PID reuse) treats the tracked process as exited, even though alive:true was reported for the new occupant', () => {
  const ledger = createPidLedger({ coreCount: 4 });
  ledger.recordSample(100, { cpuTimeMs: 0, rssBytes: 1000, alive: true, fingerprint: 'fp-original' }, ns(0));
  ledger.recordSample(100, { cpuTimeMs: 1000, rssBytes: 1000, alive: true, fingerprint: 'fp-original' }, ns(1000));
  const sample = ledger.recordSample(
    100,
    { cpuTimeMs: 10, rssBytes: 500, alive: true, fingerprint: 'fp-different-process' },
    ns(2000),
  );
  assert.equal(sample.alive, false);
  assert.equal(sample.cpuPercent, null);
  assert.equal(ledger.isTerminal(100), true);
});

test('PIDLedger: a matching fingerprint across samples does not falsely trigger exit', () => {
  const ledger = createPidLedger({ coreCount: 4 });
  ledger.recordSample(100, { cpuTimeMs: 0, rssBytes: 1000, alive: true, fingerprint: 'fp-a' }, ns(0));
  const sample = ledger.recordSample(100, { cpuTimeMs: 500, rssBytes: 1000, alive: true, fingerprint: 'fp-a' }, ns(1000));
  assert.equal(sample.alive, true);
  assert.equal(ledger.isTerminal(100), false);
});

test('PIDLedger: tracks multiple pids independently without cross-contamination', () => {
  const ledger = createPidLedger({ coreCount: 4 });
  ledger.recordSample(1, { cpuTimeMs: 0, rssBytes: 100, alive: true, fingerprint: 'a' }, ns(0));
  ledger.recordSample(2, { cpuTimeMs: 0, rssBytes: 200, alive: true, fingerprint: 'b' }, ns(0));
  const s1 = ledger.recordSample(1, { cpuTimeMs: 1000, rssBytes: 100, alive: true, fingerprint: 'a' }, ns(1000));
  const s2 = ledger.recordSample(2, { cpuTimeMs: 2000, rssBytes: 200, alive: true, fingerprint: 'b' }, ns(1000));
  assert.equal(s1.cpuPercent, 25);
  assert.equal(s2.cpuPercent, 50);
});

test('PIDLedger: forget() removes tracking state so a subsequent sample is treated as first-ever again', () => {
  const ledger = createPidLedger({ coreCount: 4 });
  ledger.recordSample(100, { cpuTimeMs: 0, rssBytes: 1000, alive: true, fingerprint: 'fp-a' }, ns(0));
  ledger.recordSample(100, { cpuTimeMs: 1000, rssBytes: 1000, alive: true, fingerprint: 'fp-a' }, ns(1000));
  assert.equal(ledger.has(100), true);
  ledger.forget(100);
  assert.equal(ledger.has(100), false);
  const sample = ledger.recordSample(100, { cpuTimeMs: 0, rssBytes: 1000, alive: true, fingerprint: 'fp-b' }, ns(2000));
  assert.equal(sample.firstSample, true);
  assert.equal(sample.cpuPercent, null);
});

test('PIDLedger: size() reflects the number of tracked pids', () => {
  const ledger = createPidLedger();
  assert.equal(ledger.size(), 0);
  ledger.recordSample(1, { cpuTimeMs: 0, rssBytes: 0, alive: true, fingerprint: 'a' }, ns(0));
  ledger.recordMiss(2, ns(0));
  assert.equal(ledger.size(), 2);
});

test('PIDLedger: a per-call coreCount override wins over the ledger default', () => {
  const ledger = createPidLedger({ coreCount: 8 });
  ledger.recordSample(100, { cpuTimeMs: 0, rssBytes: 0, alive: true, fingerprint: 'fp-a' }, ns(0), 1);
  const sample = ledger.recordSample(100, { cpuTimeMs: 1000, rssBytes: 0, alive: true, fingerprint: 'fp-a' }, ns(1000), 1);
  assert.equal(sample.cpuPercent, 100);
});
