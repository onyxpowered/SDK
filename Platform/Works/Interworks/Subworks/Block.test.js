// SDK
// Designed & Built By onyxpowered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBlockHandle, waitUntilReady, createStaticBlockHandle, blockOrigin } from './Block.js';

test('validateBlockHandle rejects a missing or empty name', () => {
  assert.throws(() => validateBlockHandle({ host: '127.0.0.1', port: 3000, isReady: () => true }), /non-empty "name"/);
});

test('validateBlockHandle rejects a missing host', () => {
  assert.throws(() => validateBlockHandle({ name: 'web', port: 3000, isReady: () => true }), /non-empty "host"/);
});

test('validateBlockHandle rejects an invalid port', () => {
  assert.throws(() => validateBlockHandle({ name: 'web', host: '127.0.0.1', port: 0, isReady: () => true }), /valid "port"/);
  assert.throws(() => validateBlockHandle({ name: 'web', host: '127.0.0.1', port: 70000, isReady: () => true }), /valid "port"/);
  assert.throws(() => validateBlockHandle({ name: 'web', host: '127.0.0.1', port: 3.5, isReady: () => true }), /valid "port"/);
});

test('validateBlockHandle rejects a missing isReady function', () => {
  assert.throws(() => validateBlockHandle({ name: 'web', host: '127.0.0.1', port: 3000 }), /"isReady" function/);
});

test('validateBlockHandle accepts a well-formed handle', () => {
  assert.equal(validateBlockHandle({ name: 'web', host: '127.0.0.1', port: 3000, isReady: () => true }), true);
});

test('createStaticBlockHandle builds a valid handle with sensible defaults', () => {
  const handle = createStaticBlockHandle({ port: 4000 });
  assert.equal(handle.name, 'block');
  assert.equal(handle.host, '127.0.0.1');
  assert.equal(handle.port, 4000);
});

test('createStaticBlockHandle accepts a boolean or a function for readiness', async () => {
  const staticReady = createStaticBlockHandle({ port: 4000, ready: false });
  assert.equal(await staticReady.isReady(), false);

  let flips = false;
  const dynamic = createStaticBlockHandle({ port: 4000, ready: () => flips });
  assert.equal(await dynamic.isReady(), false);
  flips = true;
  assert.equal(await dynamic.isReady(), true);
});

test('blockOrigin builds an http origin from host and port', () => {
  const handle = createStaticBlockHandle({ host: '127.0.0.1', port: 5173 });
  assert.equal(blockOrigin(handle), 'http://127.0.0.1:5173');
});

test('waitUntilReady resolves true as soon as isReady reports true', async () => {
  let calls = 0;
  const handle = createStaticBlockHandle({
    port: 3000,
    ready: () => {
      calls += 1;
      return calls >= 3;
    },
  });
  const ready = await waitUntilReady(handle, { intervalMs: 1, timeoutMs: 1000 });
  assert.equal(ready, true);
  assert.ok(calls >= 3);
});

test('waitUntilReady resolves false once the timeout elapses without readiness', async () => {
  const handle = createStaticBlockHandle({ port: 3000, ready: false });
  const ready = await waitUntilReady(handle, { intervalMs: 5, timeoutMs: 30 });
  assert.equal(ready, false);
});

test('waitUntilReady validates the handle before polling', async () => {
  await assert.rejects(() => waitUntilReady({ port: 3000 }), /must declare/);
});
