// SDK
// Designed & Built By onyxpowered.

export function createTestSampler(options = {}) {
  let tickCount = 0;

  const sampler = {
    async sampleMemory() {
      tickCount += 1;
      if (options.memoryShouldFail) {
        throw new Error('fixture memory failure');
      }
      return { totalBytes: 1000, usedBytes: 500, freeBytes: 500, degraded: false };
    },
    async sampleProcessesChunk(pidChunk) {
      const result = new Map();
      for (const pid of pidChunk) {
        result.set(pid, { cpuTimeMs: tickCount * 10, rssBytes: 1024, alive: true, fingerprint: 'fixture' });
      }
      return result;
    },
    async sampleProcessTree() {
      return { getChildren: () => [], degraded: false };
    },
  };

  if (options.probeOk !== undefined) {
    sampler.probeCapability = async () => (options.probeOk ? { ok: true } : { ok: false, reason: 'fixture-blocked' });
  }

  if (options.trackStop) {
    sampler.stop = () => {
      options.trackStop.called = true;
    };
  }

  return sampler;
}
