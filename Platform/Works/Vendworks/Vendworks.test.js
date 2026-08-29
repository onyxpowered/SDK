// Ship
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVault } from '../../Vault/Vault.js';
import {
  VERSION,
  createVendworks,
  createRegistryClient,
  validateConnector,
  parseConnectorName,
  connectorRole,
} from './Vendworks.js';

test('Vendworks: exports a semver-shaped VERSION', () => {
  assert.equal(typeof VERSION, 'string');
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
});

test('Vendworks: re-exports the Contract.js and Roles.js primitives untouched', () => {
  assert.equal(typeof validateConnector, 'function');
  assert.equal(typeof parseConnectorName, 'function');
  assert.equal(connectorRole('@onyxlabs/stripe'), 'connector__onyxlabs__stripe');
});

test('Vendworks: createVendworks refuses to boot without a shaped registry client', () => {
  assert.throws(() => createVendworks({ vault: {}, registryClient: {} }), /missing required method/);
});

test('Vendworks: createVendworks wires a full install -> list -> uninstall cycle through the facade', async () => {
  const shipHome = await mkdtemp(join(tmpdir(), 'vendworks-facade-'));
  try {
    const vault = await createVault({ shipHome });
    const registryClient = createRegistryClient({
      fetchConnectorManifest: async () => ({ latestVersion: '1.0.0' }),
      fetchConnectorSource: async () => ({
        version: '1.0.0',
        entry: 'index.js',
        files: [
          {
            path: 'index.js',
            contents: "export const configSchema = { apiKey: { secret: true } };\nexport async function register(ship) {}\n",
          },
        ],
      }),
    });

    const vendworks = createVendworks({ vault, registryClient, shipHome });

    const installResult = await vendworks.install('@onyxlabs/stripe', { askSecret: async () => 'sk_test' });
    assert.equal(installResult.role, connectorRole('@onyxlabs/stripe'));

    const listed = await vendworks.list();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].name, '@onyxlabs/stripe');

    const uninstallResult = await vendworks.uninstall('@onyxlabs/stripe');
    assert.equal(uninstallResult.wiped, true);
    assert.deepEqual(await vendworks.list(), []);
  } finally {
    await rm(shipHome, { recursive: true, force: true });
  }
});
