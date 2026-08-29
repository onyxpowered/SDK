// Ship
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readInstalledMetadata, writeInstalledMetadata } from './InstalledStore.js';

async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), 'vendworks-installedstore-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('InstalledStore: readInstalledMetadata returns undefined when nothing has been written yet', async () => {
  await withTempDir(async (dir) => {
    const metadataPath = join(dir, 'nested', '.ship-connector.json');
    assert.equal(await readInstalledMetadata(metadataPath), undefined);
  });
});

test('InstalledStore: write then read round-trips the metadata exactly, creating parent directories', async () => {
  await withTempDir(async (dir) => {
    const metadataPath = join(dir, 'onyxlabs', 'stripe', '.ship-connector.json');
    const metadata = { name: '@onyxlabs/stripe', version: '1.0.0', configKeys: ['apiKey'] };
    await writeInstalledMetadata(metadataPath, metadata);
    assert.ok(existsSync(metadataPath));
    assert.deepEqual(await readInstalledMetadata(metadataPath), metadata);
  });
});

test('InstalledStore: a second write overwrites the first and leaves no temp file behind', async () => {
  await withTempDir(async (dir) => {
    const metadataPath = join(dir, '.ship-connector.json');
    await writeInstalledMetadata(metadataPath, { version: '1.0.0' });
    await writeInstalledMetadata(metadataPath, { version: '2.0.0' });
    assert.deepEqual(await readInstalledMetadata(metadataPath), { version: '2.0.0' });
  });
});
