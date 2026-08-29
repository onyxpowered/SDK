// Ship
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishConnector, defaultReadSourceFiles } from './Publisher.js';
import { createRegistryClient } from './RegistryClient.js';

async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), 'vendworks-publisher-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeConnectorSource(dir, extraFiles = {}) {
  await writeFile(
    join(dir, 'index.js'),
    "export const configSchema = { apiKey: { description: 'key', secret: true } };\nexport async function register(ship) {}\n",
  );
  for (const [relativePath, contents] of Object.entries(extraFiles)) {
    const full = join(dir, relativePath);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, contents);
  }
}

test('Publisher: defaultReadSourceFiles walks a real directory tree into path/contents pairs', async () => {
  await withTempDir(async (dir) => {
    await writeConnectorSource(dir, { 'lib/Helper.js': 'export const helper = 1;\n' });
    const files = await defaultReadSourceFiles(dir);
    const paths = files.map((file) => file.path).sort();
    assert.deepEqual(paths, ['index.js', 'lib/Helper.js']);
  });
});

test('Publisher: publishConnector validates the connector, bundles its source, and forwards it to the registry client', async () => {
  await withTempDir(async (dir) => {
    await writeConnectorSource(dir);
    let receivedPayload;
    let receivedToken;
    const registryClient = createRegistryClient({
      publishConnector: async (payload, token) => {
        receivedPayload = payload;
        receivedToken = token;
        return { publishedAt: '2026-08-18T00:00:00.000Z' };
      },
    });

    const result = await publishConnector({
      name: '@onyxlabs/stripe',
      version: '1.0.0',
      sourceDir: dir,
      description: 'Stripe payments connector',
      token: 'ship-login-token',
      registryClient,
    });

    assert.equal(result.name, '@onyxlabs/stripe');
    assert.equal(result.publisher, 'onyxlabs');
    assert.equal(result.connector, 'stripe');
    assert.equal(result.publishedAt, '2026-08-18T00:00:00.000Z');

    assert.equal(receivedToken, 'ship-login-token');
    assert.equal(receivedPayload.publisher, 'onyxlabs');
    assert.equal(receivedPayload.connector, 'stripe');
    assert.equal(receivedPayload.version, '1.0.0');
    assert.deepEqual(receivedPayload.configSchema, { apiKey: { description: 'key', secret: true } });
    assert.ok(receivedPayload.files.some((file) => file.path === 'index.js'));
  });
});

test('Publisher: publishConnector rejects a connector that fails contract validation', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, 'index.js'), 'export const configSchema = {};\n');
    const registryClient = createRegistryClient({ publishConnector: async () => ({}) });
    await assert.rejects(
      publishConnector({ name: '@onyxlabs/broken', version: '1.0.0', sourceDir: dir, token: 't', registryClient }),
      /must export a register\(ship\) function/,
    );
  });
});

test('Publisher: publishConnector requires a version', async () => {
  await withTempDir(async (dir) => {
    await writeConnectorSource(dir);
    const registryClient = createRegistryClient({ publishConnector: async () => ({}) });
    await assert.rejects(
      publishConnector({ name: '@onyxlabs/stripe', sourceDir: dir, token: 't', registryClient }),
      /requires a version string/,
    );
  });
});

test('Publisher: publishConnector requires a login token', async () => {
  await withTempDir(async (dir) => {
    await writeConnectorSource(dir);
    const registryClient = createRegistryClient({ publishConnector: async () => ({}) });
    await assert.rejects(
      publishConnector({ name: '@onyxlabs/stripe', version: '1.0.0', sourceDir: dir, registryClient }),
      /requires an auth token/,
    );
  });
});

test('Publisher: publishConnector rejects a name that is not namespaced', async () => {
  await withTempDir(async (dir) => {
    await writeConnectorSource(dir);
    const registryClient = createRegistryClient({ publishConnector: async () => ({}) });
    await assert.rejects(
      publishConnector({ name: 'stripe', version: '1.0.0', sourceDir: dir, token: 't', registryClient }),
      /must be @publisher\/name/,
    );
  });
});
