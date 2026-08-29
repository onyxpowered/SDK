// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { selectSampler, SUPPORTED_PLATFORMS } from './Sampler.js';

function assertSamplerShape(sampler) {
  assert.equal(typeof sampler.sampleMemory, 'function');
  assert.equal(typeof sampler.sampleProcessesChunk, 'function');
  assert.equal(typeof sampler.sampleProcessTree, 'function');
}

test('Sampler: SUPPORTED_PLATFORMS lists exactly the three platforms Plan.txt section 7 covers', () => {
  assert.deepEqual([...SUPPORTED_PLATFORMS].sort(), ['darwin', 'linux', 'win32']);
});

test('Sampler: selectSampler(linux) returns a LinuxSampler-shaped backend', () => {
  const sampler = selectSampler('linux');
  assertSamplerShape(sampler);
  assert.equal(typeof sampler.probeCapability, 'function');
});

test('Sampler: selectSampler(darwin) returns a MacSampler-shaped backend', () => {
  const sampler = selectSampler('darwin');
  assertSamplerShape(sampler);
});

test('Sampler: selectSampler(win32) returns a WindowsSampler-shaped backend', async (t) => {
  const sampler = selectSampler('win32');
  t.after(() => sampler.stop());
  assertSamplerShape(sampler);
  assert.equal(typeof sampler.probeCapability, 'function');
  assert.equal(typeof sampler.getHostState, 'function');
});

test('Sampler: selectSampler throws a clear error for an unsupported platform', () => {
  assert.throws(() => selectSampler('freebsd'), /unsupported platform/);
});

test('Sampler: selectSampler defaults to process.platform when not given one', () => {
  const sampler = selectSampler(undefined, {
    linux: {},
    mac: {},
    windows: {},
  });
  assertSamplerShape(sampler);
  if (typeof sampler.stop === 'function') sampler.stop();
});

test('Sampler: selectSampler forwards per-platform options to the chosen backend constructor', async () => {
  const sampler = selectSampler('darwin', {
    mac: { totalMem: () => 123456, freeMem: () => 1000, execFileImpl: async () => { throw new Error('no subprocess in this test'); } },
  });
  const result = await sampler.sampleMemory();
  assert.equal(result.totalBytes, 123456);
});
