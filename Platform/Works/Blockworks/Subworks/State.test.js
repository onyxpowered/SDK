// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBlockStateStore } from './State.js';

async function withTempStateDir(run) {
  const dir = await mkdtemp(join(tmpdir(), 'ship-blockstate-test-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('State: readBlockState returns undefined for a Block that was never written', async () => {
  await withTempStateDir(async (dir) => {
    const store = await createBlockStateStore(dir);
    const value = await store.readBlockState('my-app', 'web');
    assert.equal(value, undefined);
  });
});

test('State: writeBlockState then readBlockState round-trips the record', async () => {
  await withTempStateDir(async (dir) => {
    const store = await createBlockStateStore(dir);
    await store.writeBlockState('my-app', 'web', { state: 'running', pid: 4242 });
    const value = await store.readBlockState('my-app', 'web');
    assert.deepEqual(value, { state: 'running', pid: 4242 });
  });
});

test('State: writing the same Block twice, read returns the latest value', async () => {
  await withTempStateDir(async (dir) => {
    const store = await createBlockStateStore(dir);
    await store.writeBlockState('my-app', 'web', { state: 'starting' });
    await store.writeBlockState('my-app', 'web', { state: 'running', pid: 99 });
    const value = await store.readBlockState('my-app', 'web');
    assert.deepEqual(value, { state: 'running', pid: 99 });
  });
});

test('State: readAppState returns every Block under an App keyed by Block name', async () => {
  await withTempStateDir(async (dir) => {
    const store = await createBlockStateStore(dir);
    await store.writeBlockState('my-app', 'web', { state: 'running' });
    await store.writeBlockState('my-app', 'worker', { state: 'crashed' });
    const value = await store.readAppState('my-app');
    assert.deepEqual(value, { web: { state: 'running' }, worker: { state: 'crashed' } });
  });
});

test('State: readAppState returns an empty object for an App with no recorded Blocks', async () => {
  await withTempStateDir(async (dir) => {
    const store = await createBlockStateStore(dir);
    assert.deepEqual(await store.readAppState('ghost-app'), {});
  });
});

test('State: listApps returns every App that has at least one Block state written', async () => {
  await withTempStateDir(async (dir) => {
    const store = await createBlockStateStore(dir);
    await store.writeBlockState('app-a', 'web', { state: 'running' });
    await store.writeBlockState('app-b', 'web', { state: 'running' });
    const apps = await store.listApps();
    assert.deepEqual(apps.sort(), ['app-a', 'app-b']);
  });
});

test('State: removeBlock deletes just that one Block, leaving its siblings intact', async () => {
  await withTempStateDir(async (dir) => {
    const store = await createBlockStateStore(dir);
    await store.writeBlockState('my-app', 'web', { state: 'running' });
    await store.writeBlockState('my-app', 'worker', { state: 'running' });
    await store.removeBlock('my-app', 'web');
    assert.equal(await store.readBlockState('my-app', 'web'), undefined);
    assert.notEqual(await store.readBlockState('my-app', 'worker'), undefined);
  });
});

test('State: removeApp deletes every Block under that App', async () => {
  await withTempStateDir(async (dir) => {
    const store = await createBlockStateStore(dir);
    await store.writeBlockState('my-app', 'web', { state: 'running' });
    await store.writeBlockState('my-app', 'worker', { state: 'running' });
    await store.removeApp('my-app');
    assert.deepEqual(await store.readAppState('my-app'), {});
    assert.deepEqual(await store.listApps(), []);
  });
});

test('State: listAllKnownBlocks flattens every App/Block pair with its record spread in', async () => {
  await withTempStateDir(async (dir) => {
    const store = await createBlockStateStore(dir);
    await store.writeBlockState('app-a', 'web', { state: 'running', pid: 1 });
    await store.writeBlockState('app-b', 'worker', { state: 'crashed', pid: 2 });
    const known = await store.listAllKnownBlocks();
    const sorted = known.sort((a, b) => a.appName.localeCompare(b.appName));
    assert.deepEqual(sorted, [
      { appName: 'app-a', blockName: 'web', state: 'running', pid: 1 },
      { appName: 'app-b', blockName: 'worker', state: 'crashed', pid: 2 },
    ]);
  });
});

test('State: an App name containing ".." path-traversal is rejected', async () => {
  await withTempStateDir(async (dir) => {
    const store = await createBlockStateStore(dir);
    await assert.rejects(() => store.writeBlockState('../../escaped', 'web', {}), /invalid App name/);
  });
});

test('State: a Block name containing a literal "/" is rejected', async () => {
  await withTempStateDir(async (dir) => {
    const store = await createBlockStateStore(dir);
    await assert.rejects(() => store.writeBlockState('my-app', 'evil/block', {}), /invalid Block name/);
  });
});

test(
  'State: Block state files are written with 0600 permissions, not world-readable',
  { skip: process.platform === 'win32' },
  async () => {
    await withTempStateDir(async (dir) => {
      const store = await createBlockStateStore(dir);
      await store.writeBlockState('my-app', 'web', { state: 'running' });
      const info = await stat(join(dir, 'my-app', 'web.json'));
      assert.equal(info.mode & 0o777, 0o600);
    });
  },
);

test('State: writeBlockState is unencrypted plain JSON on disk (this store is deliberately not Vault)', async () => {
  await withTempStateDir(async (dir) => {
    const store = await createBlockStateStore(dir);
    await store.writeBlockState('my-app', 'web', { state: 'running', pid: 4242 });
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(join(dir, 'my-app', 'web.json'), 'utf8');
    assert.deepEqual(JSON.parse(raw), { state: 'running', pid: 4242 });
    assert.ok(!existsSync(join(dir, 'master.key')));
  });
});
