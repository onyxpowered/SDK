// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileStore } from './Store.js';

async function withTempVaultDir(run) {
  const dir = await mkdtemp(join(tmpdir(), 'ship-store-test-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('Store: ".." as a whole path segment is rejected', async () => {
  await withTempVaultDir(async (vaultRoot) => {
    const store = await createFileStore(vaultRoot);
    await store.declareRole('role-a');
    await assert.rejects(() => store.write('role-a', '..', 'x'), /invalid Vault path segment/);
  });
});

test('Store: a path that collapses to zero segments is rejected', async () => {
  await withTempVaultDir(async (vaultRoot) => {
    const store = await createFileStore(vaultRoot);
    await store.declareRole('role-a');
    await assert.rejects(() => store.write('role-a', '///', 'x'), /must contain at least one segment/);
  });
});

test('Store: a traversal path containing "../.." is rejected and no file lands outside the role directory', async () => {
  await withTempVaultDir(async (vaultRoot) => {
    const store = await createFileStore(vaultRoot);
    await store.declareRole('role-a');
    await assert.rejects(
      () => store.write('role-a', '../../outside-secret', 'x'),
      /invalid Vault path segment/,
    );
    const escapedPath = join(vaultRoot, '..', '..', 'outside-secret.json');
    assert.equal(existsSync(escapedPath), false);
  });
});

test('Store: reading a declared-role path that was never written returns undefined, not a throw', async () => {
  await withTempVaultDir(async (vaultRoot) => {
    const store = await createFileStore(vaultRoot);
    await store.declareRole('role-a');
    const value = await store.read('role-a', 'never/written');
    assert.equal(value, undefined);
  });
});

test('Store: an undeclared role throws on read, unlike the never-written-but-declared case', async () => {
  await withTempVaultDir(async (vaultRoot) => {
    const store = await createFileStore(vaultRoot);
    await assert.rejects(() => store.read('never-declared-role', 'anything'), /has not been declared/);
  });
});

test('Store: writing the same path twice with a different value, read() returns the latest', async () => {
  await withTempVaultDir(async (vaultRoot) => {
    const store = await createFileStore(vaultRoot);
    await store.declareRole('role-a');
    await store.write('role-a', 'key', 'first-value');
    await store.write('role-a', 'key', 'second-value');
    const value = await store.read('role-a', 'key');
    assert.equal(value, 'second-value');
  });
});

test('Store: the master key persists across a fresh createFileStore against the same directory', async () => {
  await withTempVaultDir(async (vaultRoot) => {
    const storeA = await createFileStore(vaultRoot);
    const storeB = await createFileStore(vaultRoot);
    assert.deepEqual(storeA.getMasterKey(), storeB.getMasterKey());
  });
});

test('Store: declaring a case-variant of the reserved role ("_Ship") is rejected outright, never silently colliding with "_ship"', async () => {
  await withTempVaultDir(async (vaultRoot) => {
    const store = await createFileStore(vaultRoot);
    await assert.rejects(() => store.declareRole('_Ship'), /invalid Vault role/);
    await assert.rejects(() => store.declareRole('_SHIP'), /invalid Vault role/);
    await assert.rejects(() => store.read('_Ship', 'anything'), /invalid Vault role/);
    await assert.rejects(() => store.write('_Ship', 'anything', 1), /invalid Vault role/);
  });
});

test('Store: wipeRole also rejects a case-variant of the reserved role', async () => {
  await withTempVaultDir(async (vaultRoot) => {
    const store = await createFileStore(vaultRoot);
    await assert.rejects(() => store.wipeRole('_Ship'), /invalid Vault role/);
  });
});

test('Store: declaring the reserved role in its correct lowercase form is still rejected as a regular role', async () => {
  await withTempVaultDir(async (vaultRoot) => {
    const store = await createFileStore(vaultRoot);
    await assert.rejects(() => store.declareRole('_ship'), /reserved _ship namespace/);
  });
});

test('Store: two roles differing only in case never collide -- the case-variant declaration is rejected outright', async () => {
  await withTempVaultDir(async (vaultRoot) => {
    const store = await createFileStore(vaultRoot);
    await store.declareRole('connector-stripe');
    await assert.rejects(() => store.declareRole('connector-Stripe'), /invalid Vault role/);
    await store.write('connector-stripe', 'apiKey', 'value-from-the-real-role');
    const value = await store.read('connector-stripe', 'apiKey');
    assert.equal(value, 'value-from-the-real-role');
  });
});

test('Store: a role containing ".." path-traversal segments is rejected and nothing lands outside the vault root', async () => {
  await withTempVaultDir(async (vaultRoot) => {
    const store = await createFileStore(vaultRoot);
    await assert.rejects(() => store.declareRole('../../escaped-sibling'), /invalid Vault role/);
    const escapedDir = join(vaultRoot, '..', '..', 'escaped-sibling');
    assert.equal(existsSync(escapedDir), false);
  });
});

test('Store: a role containing a literal "/" is rejected', async () => {
  await withTempVaultDir(async (vaultRoot) => {
    const store = await createFileStore(vaultRoot);
    await assert.rejects(() => store.declareRole('connector/evil'), /invalid Vault role/);
    await assert.rejects(() => store.write('connector/evil', 'x', 1), /invalid Vault role/);
  });
});

test(
  'Store: written role data files are created with 0600 permissions, not world-readable',
  { skip: process.platform === 'win32' },
  async () => {
    await withTempVaultDir(async (vaultRoot) => {
      const store = await createFileStore(vaultRoot);
      await store.declareRole('role-a');
      await store.write('role-a', 'secret', 'x');
      const { stat } = await import('node:fs/promises');
      const info = await stat(join(vaultRoot, 'roles', 'role-a', 'secret.json'));
      assert.equal(info.mode & 0o777, 0o600);
    });
  },
);

test('Store: role directories are created with 0700 permissions', { skip: process.platform === 'win32' }, async () => {
  await withTempVaultDir(async (vaultRoot) => {
    const store = await createFileStore(vaultRoot);
    await store.declareRole('role-a');
    const { stat } = await import('node:fs/promises');
    const info = await stat(join(vaultRoot, 'roles', 'role-a'));
    assert.equal(info.mode & 0o777, 0o700);
  });
});

test('Store: roles.json manifest is created with 0600 permissions', { skip: process.platform === 'win32' }, async () => {
  await withTempVaultDir(async (vaultRoot) => {
    const store = await createFileStore(vaultRoot);
    await store.declareRole('role-a');
    const { stat } = await import('node:fs/promises');
    const info = await stat(join(vaultRoot, 'roles.json'));
    assert.equal(info.mode & 0o777, 0o600);
  });
});

test('Store: the master key file is created with 0600 permissions', { skip: process.platform === 'win32' }, async () => {
  await withTempVaultDir(async (vaultRoot) => {
    await createFileStore(vaultRoot);
    const { stat } = await import('node:fs/promises');
    const info = await stat(join(vaultRoot, 'master.key'));
    assert.equal(info.mode & 0o777, 0o600);
  });
});

test('Store: concurrent createFileStore calls against a fresh directory converge on the same master key', async () => {
  await withTempVaultDir(async (vaultRoot) => {
    const [storeA, storeB, storeC] = await Promise.all([
      createFileStore(vaultRoot),
      createFileStore(vaultRoot),
      createFileStore(vaultRoot),
    ]);
    const keyA = storeA.getMasterKey().toString('hex');
    const keyB = storeB.getMasterKey().toString('hex');
    const keyC = storeC.getMasterKey().toString('hex');
    assert.equal(keyA, keyB);
    assert.equal(keyA, keyC);
  });
});
