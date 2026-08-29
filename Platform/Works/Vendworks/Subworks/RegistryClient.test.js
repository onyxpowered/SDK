// Ship
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { REGISTRY_CLIENT_METHODS, createRegistryClient, assertRegistryClient } from './RegistryClient.js';

test('RegistryClient: REGISTRY_CLIENT_METHODS is frozen and names the full injectable surface', () => {
  assert.ok(Object.isFrozen(REGISTRY_CLIENT_METHODS));
  assert.deepEqual(
    [...REGISTRY_CLIENT_METHODS].sort(),
    ['fetchConnectorManifest', 'fetchConnectorSource', 'publishConnector', 'searchConnectors'].sort(),
  );
});

test('RegistryClient: createRegistryClient with no overrides implements every method but rejects when called', async () => {
  const client = createRegistryClient();
  for (const methodName of REGISTRY_CLIENT_METHODS) {
    assert.equal(typeof client[methodName], 'function');
    await assert.rejects(client[methodName](), /does not implement/);
  }
});

test('RegistryClient: createRegistryClient wires a provided override through untouched', async () => {
  const manifest = { publisher: 'onyxlabs', connector: 'stripe', latestVersion: '1.0.0' };
  const client = createRegistryClient({
    fetchConnectorManifest: async () => manifest,
  });
  assert.deepEqual(await client.fetchConnectorManifest({ publisher: 'onyxlabs', connector: 'stripe' }), manifest);
  await assert.rejects(client.searchConnectors({}), /does not implement/);
});

test('RegistryClient: createRegistryClient rejects a non-function override', () => {
  assert.throws(() => createRegistryClient({ fetchConnectorManifest: 'nope' }), /must be a function/);
});

test('RegistryClient: assertRegistryClient accepts an object implementing all four methods', () => {
  const client = {
    fetchConnectorManifest: () => {},
    fetchConnectorSource: () => {},
    publishConnector: () => {},
    searchConnectors: () => {},
  };
  assert.equal(assertRegistryClient(client), true);
});

test('RegistryClient: assertRegistryClient rejects a client missing a required method', () => {
  const client = {
    fetchConnectorManifest: () => {},
    fetchConnectorSource: () => {},
    publishConnector: () => {},
  };
  assert.throws(() => assertRegistryClient(client), /missing required method "searchConnectors"/);
});

test('RegistryClient: assertRegistryClient rejects a non-object', () => {
  assert.throws(() => assertRegistryClient(null), /must be an object/);
  assert.throws(() => assertRegistryClient('client'), /must be an object/);
});
