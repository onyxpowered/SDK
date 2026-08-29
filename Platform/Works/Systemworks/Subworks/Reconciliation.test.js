// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileBlocks } from './Reconciliation.js';

test('Reconciliation: empty known-block list reattaches nothing and stays empty', async () => {
  const result = await reconcileBlocks({ listKnownBlocks: async () => [] });
  assert.deepEqual(result, { reattached: [], stale: [] });
});

test('Reconciliation: buckets blocks correctly by fingerprintCheck result', async () => {
  const aliveBlock = { pid: 1, name: 'web' };
  const deadBlock = { pid: 2, name: 'worker' };
  const result = await reconcileBlocks({
    listKnownBlocks: async () => [aliveBlock, deadBlock],
    fingerprintCheck: async (block) => block.pid === 1,
  });
  assert.deepEqual(result.reattached, [aliveBlock]);
  assert.deepEqual(result.stale, [deadBlock]);
});

test('Reconciliation: a fingerprintCheck that throws for one block is treated as stale and does not abort the others', async () => {
  const aliveBlock = { pid: 1, name: 'web' };
  const throwingBlock = { pid: 2, name: 'flaky' };
  const deadBlock = { pid: 3, name: 'worker' };
  const result = await reconcileBlocks({
    listKnownBlocks: async () => [aliveBlock, throwingBlock, deadBlock],
    fingerprintCheck: async (block) => {
      if (block.pid === 1) return true;
      if (block.pid === 2) throw new Error('fingerprint probe failed');
      return false;
    },
  });
  assert.deepEqual(result.reattached, [aliveBlock]);
  assert.deepEqual(result.stale, [throwingBlock, deadBlock]);
});

test('Reconciliation: the default fingerprintCheck (which always throws) never aborts reconciliation when it is actually reached', async () => {
  const knownBlock = { pid: 99, name: 'orphan' };
  const result = await reconcileBlocks({ listKnownBlocks: async () => [knownBlock] });
  assert.deepEqual(result, { reattached: [], stale: [knownBlock] });
});

test('Reconciliation: logs a warning for a failed fingerprintCheck without throwing', async () => {
  const warnings = [];
  const logger = {
    async info() {},
    async warn(message, meta) {
      warnings.push({ message, meta });
    },
    async error() {},
  };
  const result = await reconcileBlocks({
    listKnownBlocks: async () => [{ pid: 1 }],
    fingerprintCheck: async () => {
      throw new Error('boom');
    },
    logger,
  });
  assert.deepEqual(result, { reattached: [], stale: [{ pid: 1 }] });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /fingerprintCheck failed/);
});
