// Ship
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConnectorModule, DEFAULT_ENTRY_FILE } from './Loader.js';

async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), 'vendworks-loader-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('Loader: DEFAULT_ENTRY_FILE is index.js', () => {
  assert.equal(DEFAULT_ENTRY_FILE, 'index.js');
});

test('Loader: loads a real connector module written to disk via named exports', async () => {
  await withTempDir(async (dir) => {
    const entryPath = join(dir, 'index.js');
    await writeFile(
      entryPath,
      "export const configSchema = { apiKey: 'the api key' };\nexport async function register(ship) { return ship; }\n",
    );
    const connectorModule = await loadConnectorModule(entryPath);
    assert.equal(typeof connectorModule.register, 'function');
    assert.deepEqual(connectorModule.configSchema, { apiKey: 'the api key' });
  });
});

test('Loader: loads a real connector module exported via export default', async () => {
  await withTempDir(async (dir) => {
    const entryPath = join(dir, 'index.js');
    await writeFile(
      entryPath,
      'export default { configSchema: {}, register: async () => {} };\n',
    );
    const connectorModule = await loadConnectorModule(entryPath);
    assert.equal(typeof connectorModule.register, 'function');
  });
});

test('Loader: reloading the same path after the file changes picks up the new contents (cache-busted)', async () => {
  await withTempDir(async (dir) => {
    const entryPath = join(dir, 'index.js');
    await writeFile(entryPath, "export const version = 'one';\nexport async function register() {}\n");
    const first = await loadConnectorModule(entryPath);
    assert.equal(first.version, 'one');

    await writeFile(entryPath, "export const version = 'two';\nexport async function register() {}\n");
    const second = await loadConnectorModule(entryPath);
    assert.equal(second.version, 'two');
  });
});

test('Loader: rejects an entry file that exports nothing usable', async () => {
  await withTempDir(async (dir) => {
    const entryPath = join(dir, 'index.js');
    await writeFile(entryPath, 'export default null;\n');
    await assert.rejects(loadConnectorModule(entryPath), /did not export a connector object/);
  });
});

test('Loader: requires a non-empty entry path', async () => {
  await assert.rejects(loadConnectorModule(''), /requires an entry file path/);
});

test('Loader: uses an injected importModule instead of a real dynamic import', async () => {
  const fakeModule = { register: async () => {} };
  let receivedUrl;
  const connectorModule = await loadConnectorModule('/some/path/index.js', async (url) => {
    receivedUrl = url;
    return fakeModule;
  });
  assert.equal(connectorModule, fakeModule);
  assert.match(receivedUrl, /^file:\/\/.*index\.js\?t=/);
});
