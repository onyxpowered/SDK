// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configFilePath, loadRawConfig, normalizeShipConfig, loadShipConfig } from './Loader.js';

async function withTempAppDir(run) {
  const dir = await mkdtemp(join(tmpdir(), 'ship-loader-test-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('Loader: configFilePath joins the App root with ship.config.js', () => {
  assert.equal(configFilePath('/apps/my-app'), join('/apps/my-app', 'ship.config.js'));
});

test('Loader: loadRawConfig reads a real ship.config.js file end to end', async () => {
  await withTempAppDir(async (dir) => {
    await writeFile(
      join(dir, 'ship.config.js'),
      "export default { blocks: { web: { command: 'node server.js' } } };\n",
    );
    const raw = await loadRawConfig(dir);
    assert.deepEqual(raw, { blocks: { web: { command: 'node server.js' } } });
  });
});

test('Loader: loadRawConfig throws a clear error when the default export is missing', async () => {
  await withTempAppDir(async (dir) => {
    await writeFile(join(dir, 'ship.config.js'), 'export const notDefault = {};\n');
    await assert.rejects(() => loadRawConfig(dir), /must have a default export/);
  });
});

test('Loader: loadRawConfig wraps a module resolution failure with the attempted path', async () => {
  await withTempAppDir(async (dir) => {
    await assert.rejects(() => loadRawConfig(dir), /failed to load/);
  });
});

test('Loader: loadRawConfig uses an injected importFn instead of a real dynamic import', async () => {
  const importFn = async (href) => {
    assert.ok(href.includes('ship.config.js'));
    return { default: { blocks: { web: { command: 'node server.js' } } } };
  };
  const raw = await loadRawConfig('/apps/my-app', { importFn });
  assert.equal(raw.blocks.web.command, 'node server.js');
});

test('Loader: loadRawConfig busts Node\'s ESM module cache on every call (real bug: edited config silently ignored on redeploy)', async () => {
  // Node caches a dynamic import() by its exact resolved URL for the life of
  // the process. A real ship.config.js import with no cache-busting would
  // silently keep returning whatever was loaded the FIRST time a given app
  // was deployed, no matter how many times the file was edited and redeployed
  // afterward -- this only shows up with the REAL import(), so it can't be
  // caught by a test that just injects a mock importFn returning fixed data
  // (that would trivially "pass" the old, broken code too).
  const dir = await mkdtemp(join(tmpdir(), 'ship-loader-cache-test-'));
  try {
    const configPath = join(dir, 'ship.config.js');
    await writeFile(configPath, "export default { blocks: { web: { command: 'first-version' } } };\n");
    const first = await loadRawConfig(dir);
    assert.equal(first.blocks.web.command, 'first-version');

    await writeFile(configPath, "export default { blocks: { web: { command: 'second-version' } } };\n");
    const second = await loadRawConfig(dir);
    assert.equal(second.blocks.web.command, 'second-version', 'a redeploy after editing ship.config.js must see the new content, not a cached first read');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Loader: normalizeShipConfig fills in App-level priority as each Block default', () => {
  const normalized = normalizeShipConfig({
    priority: 'high',
    blocks: { web: { command: 'node server.js' } },
  });
  assert.equal(normalized.blocks.web.priority, 'high');
});

test('Loader: normalizeShipConfig lets a per-Block priority override the App-level default', () => {
  const normalized = normalizeShipConfig({
    priority: 'high',
    blocks: { worker: { command: 'node worker.js', priority: 'low' } },
  });
  assert.equal(normalized.blocks.worker.priority, 'low');
});

test('Loader: normalizeShipConfig defaults priority to "normal" when nothing declares one', () => {
  const normalized = normalizeShipConfig({ blocks: { web: { command: 'node server.js' } } });
  assert.equal(normalized.priority, 'normal');
  assert.equal(normalized.blocks.web.priority, 'normal');
});

test('Loader: normalizeShipConfig defaults expose to false and dependsOn to an empty array', () => {
  const normalized = normalizeShipConfig({ blocks: { web: { command: 'node server.js' } } });
  assert.equal(normalized.blocks.web.expose, false);
  assert.deepEqual(normalized.blocks.web.dependsOn, []);
});

test('Loader: normalizeShipConfig defaults readyTimeoutMs to 30 seconds', () => {
  const normalized = normalizeShipConfig({ blocks: { web: { command: 'node server.js' } } });
  assert.equal(normalized.blocks.web.readyTimeoutMs, 30000);
});

test('Loader: normalizeShipConfig preserves an explicit readyTimeoutMs override', () => {
  const normalized = normalizeShipConfig({
    blocks: { web: { command: 'node server.js', readyTimeoutMs: 5000 } },
  });
  assert.equal(normalized.blocks.web.readyTimeoutMs, 5000);
});

test('Loader: normalizeShipConfig normalizes a missing healthCheck to null, not undefined', () => {
  const normalized = normalizeShipConfig({ blocks: { web: { command: 'node server.js' } } });
  assert.equal(normalized.blocks.web.healthCheck, null);
});

test('Loader: normalizeShipConfig preserves a declared healthCheck', () => {
  const normalized = normalizeShipConfig({
    blocks: { web: { command: 'node server.js', healthCheck: { port: 3000 } } },
  });
  assert.deepEqual(normalized.blocks.web.healthCheck, { port: 3000 });
});

test('Loader: normalizeShipConfig output is deeply frozen', () => {
  const normalized = normalizeShipConfig({ blocks: { web: { command: 'node server.js' } } });
  assert.ok(Object.isFrozen(normalized));
  assert.ok(Object.isFrozen(normalized.blocks));
  assert.ok(Object.isFrozen(normalized.blocks.web));
  assert.ok(Object.isFrozen(normalized.blocks.web.dependsOn));
  assert.ok(Object.isFrozen(normalized.blocks.web.allowance));
});

test('Loader: loadShipConfig rejects an invalid config before normalizing', async () => {
  const importFn = async () => ({ default: { blocks: {} } });
  await assert.rejects(() => loadShipConfig('/apps/my-app', { importFn }), /at least one Block/);
});

test('Loader: loadShipConfig rejects a dependency cycle surfaced by ConfigSchema', async () => {
  const importFn = async () => ({
    default: {
      blocks: {
        a: { command: 'node a.js', dependsOn: ['b'] },
        b: { command: 'node b.js', dependsOn: ['a'] },
      },
    },
  });
  await assert.rejects(() => loadShipConfig('/apps/my-app', { importFn }), /dependency cycle detected/);
});

test('Loader: loadShipConfig returns a normalized config carrying the App root directory', async () => {
  const importFn = async () => ({
    default: { blocks: { web: { command: 'node server.js', expose: true } } },
  });
  const config = await loadShipConfig('/apps/my-app', { importFn });
  assert.equal(config.appRootDir, '/apps/my-app');
  assert.equal(config.blocks.web.command, 'node server.js');
});
