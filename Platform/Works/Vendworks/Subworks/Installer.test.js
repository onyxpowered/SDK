// Ship
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVault } from '../../../Vault/Vault.js';
import { createRegistryClient } from './RegistryClient.js';
import { connectorRole } from './Roles.js';
import { defaultWriteFiles, installConnector, updateConnector, uninstallConnector, listInstalledConnectors } from './Installer.js';

const V1_SOURCE = `
export const configSchema = {
  apiKey: { description: 'the API key', secret: true },
};
export async function register(ship) {}
export async function install(ship) {
  const current = await ship.vault.read('apiKey');
  await ship.vault.write('apiKey', current + '-confirmed');
}
export async function uninstall(ship) {
  globalThis.__vendworksTestUninstallCalls = (globalThis.__vendworksTestUninstallCalls || 0) + 1;
}
`;

const V1_LEAKY_SOURCE = `
export const configSchema = {
  apiKey: { description: 'the API key', secret: true },
};
export async function register(ship) {}
export async function install(ship) {
  await ship.vault.write('somethingNeverDeclared', 'sneaky');
}
`;

const V1_NO_REGISTER_SOURCE = `
export const configSchema = {};
`;

const V1_THROWING_UNINSTALL_SOURCE = `
export const configSchema = {
  apiKey: { secret: true },
};
export async function register(ship) {}
export async function uninstall(ship) {
  throw new Error('uninstall hook exploded');
}
`;

function v2Source(newVersion) {
  return `
export const configSchema = {
  apiKey: { description: 'the API key', secret: true },
  apiSecret: { description: 'the API secret', secret: true },
};
export async function register(ship) {}
export async function update(ship, { fromVersion, toVersion }) {
  const current = await ship.vault.read('apiSecret');
  await ship.vault.write('apiSecret', current + '-v' + toVersion + '-from-' + fromVersion);
}
`;
}

function fakeRegistry({ manifests, sources }) {
  return createRegistryClient({
    fetchConnectorManifest: async ({ publisher, connector }) => manifests[`${publisher}/${connector}`],
    fetchConnectorSource: async ({ publisher, connector, version }) => sources[`${publisher}/${connector}@${version}`],
  });
}

async function withInstall(run) {
  const shipHome = await mkdtemp(join(tmpdir(), 'vendworks-installer-'));
  const vault = await createVault({ shipHome });
  try {
    await run({ shipHome, vault });
  } finally {
    await rm(shipHome, { recursive: true, force: true });
  }
}

test('Installer: defaultWriteFiles refuses to write outside the target vendor directory', async () => {
  await withInstall(async ({ shipHome }) => {
    const targetDir = join(shipHome, 'vendors', 'onyxlabs', 'evil');
    await assert.rejects(
      defaultWriteFiles(targetDir, [{ path: '../../../etc/passwd', contents: 'pwned' }]),
      /escapes its own vendor directory/,
    );
  });
});

test('Installer: installConnector runs the full happy path against a real Vault and real dynamic import', async () => {
  await withInstall(async ({ shipHome, vault }) => {
    const registryClient = fakeRegistry({
      manifests: { 'onyxlabs/stripe': { latestVersion: '1.0.0' } },
      sources: {
        'onyxlabs/stripe@1.0.0': { version: '1.0.0', entry: 'index.js', files: [{ path: 'index.js', contents: V1_SOURCE }] },
      },
    });
    const result = await installConnector({
      name: '@onyxlabs/stripe',
      vault,
      registryClient,
      shipHome,
      askSecret: async () => 'sk_test_123',
      ask: async () => {
        throw new Error('should not need a non-secret prompt for this connector');
      },
    });

    assert.equal(result.role, connectorRole('@onyxlabs/stripe'));
    assert.equal(result.version, '1.0.0');
    assert.deepEqual(result.configKeys, ['apiKey']);

    const stored = await vault.interface.read(result.role, 'apiKey');
    assert.equal(stored, 'sk_test_123-confirmed');

    const vendorDir = join(shipHome, 'vendors', 'onyxlabs', 'stripe');
    assert.ok(existsSync(join(vendorDir, 'index.js')));
    assert.ok(existsSync(join(vendorDir, '.ship-connector.json')));
  });
});

test('Installer: installConnector rejects installing the same connector twice', async () => {
  await withInstall(async ({ shipHome, vault }) => {
    const registryClient = fakeRegistry({
      manifests: { 'onyxlabs/stripe': { latestVersion: '1.0.0' } },
      sources: {
        'onyxlabs/stripe@1.0.0': { version: '1.0.0', entry: 'index.js', files: [{ path: 'index.js', contents: V1_SOURCE }] },
      },
    });
    await installConnector({ name: '@onyxlabs/stripe', vault, registryClient, shipHome, askSecret: async () => 'x' });
    await assert.rejects(
      installConnector({ name: '@onyxlabs/stripe', vault, registryClient, shipHome, askSecret: async () => 'x' }),
      /already installed/,
    );
  });
});

test('Installer: installConnector rejects and fully rolls back a connector that violates its own declared config', async () => {
  await withInstall(async ({ shipHome, vault }) => {
    const registryClient = fakeRegistry({
      manifests: { 'onyxlabs/leaky': { latestVersion: '1.0.0' } },
      sources: {
        'onyxlabs/leaky@1.0.0': {
          version: '1.0.0',
          entry: 'index.js',
          files: [{ path: 'index.js', contents: V1_LEAKY_SOURCE }],
        },
      },
    });
    await assert.rejects(
      installConnector({ name: '@onyxlabs/leaky', vault, registryClient, shipHome, askSecret: async () => 'sk' }),
      /attempted to access undeclared Vault path "somethingNeverDeclared"/,
    );

    const vendorDir = join(shipHome, 'vendors', 'onyxlabs', 'leaky');
    assert.equal(existsSync(vendorDir), false);
    assert.deepEqual(await vault.listRoles(), []);
  });
});

test('Installer: installConnector rejects and rolls back a connector missing register()', async () => {
  await withInstall(async ({ shipHome, vault }) => {
    const registryClient = fakeRegistry({
      manifests: { 'onyxlabs/broken': { latestVersion: '1.0.0' } },
      sources: {
        'onyxlabs/broken@1.0.0': {
          version: '1.0.0',
          entry: 'index.js',
          files: [{ path: 'index.js', contents: V1_NO_REGISTER_SOURCE }],
        },
      },
    });
    await assert.rejects(
      installConnector({ name: '@onyxlabs/broken', vault, registryClient, shipHome }),
      /must export a register\(ship\) function/,
    );
    assert.equal(existsSync(join(shipHome, 'vendors', 'onyxlabs', 'broken')), false);
  });
});

test('Installer: updateConnector no-ops when the registry already matches the installed version', async () => {
  await withInstall(async ({ shipHome, vault }) => {
    let sourceFetches = 0;
    const registryClient = createRegistryClient({
      fetchConnectorManifest: async () => ({ latestVersion: '1.0.0' }),
      fetchConnectorSource: async () => {
        sourceFetches += 1;
        return { version: '1.0.0', entry: 'index.js', files: [{ path: 'index.js', contents: V1_SOURCE }] };
      },
    });
    await installConnector({ name: '@onyxlabs/stripe', vault, registryClient, shipHome, askSecret: async () => 'sk' });
    assert.equal(sourceFetches, 1);

    const result = await updateConnector({ name: '@onyxlabs/stripe', vault, registryClient, shipHome });
    assert.deepEqual(result, { name: '@onyxlabs/stripe', role: connectorRole('@onyxlabs/stripe'), version: '1.0.0', updated: false });
    assert.equal(sourceFetches, 1);
  });
});

test('Installer: updateConnector auto-updates, keeps existing secrets, and only prompts for newly-declared keys', async () => {
  await withInstall(async ({ shipHome, vault }) => {
    const registryClient = fakeRegistry({
      manifests: { 'onyxlabs/stripe': { latestVersion: '1.0.0' } },
      sources: {
        'onyxlabs/stripe@1.0.0': { version: '1.0.0', entry: 'index.js', files: [{ path: 'index.js', contents: V1_SOURCE }] },
      },
    });
    await installConnector({ name: '@onyxlabs/stripe', vault, registryClient, shipHome, askSecret: async () => 'sk_original' });

    const registryClientV2 = fakeRegistry({
      manifests: { 'onyxlabs/stripe': { latestVersion: '2.0.0' } },
      sources: {
        'onyxlabs/stripe@2.0.0': { version: '2.0.0', entry: 'index.js', files: [{ path: 'index.js', contents: v2Source('2.0.0') }] },
      },
    });

    const result = await updateConnector({
      name: '@onyxlabs/stripe',
      vault,
      registryClient: registryClientV2,
      shipHome,
      askSecret: async (question) => {
        assert.match(question, /apiSecret/);
        return 'sk_new_secret';
      },
      ask: async () => {
        throw new Error('apiKey must never be re-prompted, it already exists in Vault');
      },
    });

    assert.equal(result.updated, true);
    assert.equal(result.previousVersion, '1.0.0');
    assert.equal(result.version, '2.0.0');
    assert.deepEqual(result.newlyConfiguredKeys, ['apiSecret']);

    const role = connectorRole('@onyxlabs/stripe');
    assert.equal(await vault.interface.read(role, 'apiKey'), 'sk_original-confirmed');
    assert.equal(await vault.interface.read(role, 'apiSecret'), 'sk_new_secret-v2.0.0-from-1.0.0');

    const installed = await listInstalledConnectors({ shipHome });
    assert.equal(installed[0].version, '2.0.0');
  });
});

test('Installer: updateConnector rejects a connector that was never installed', async () => {
  await withInstall(async ({ shipHome, vault }) => {
    const registryClient = createRegistryClient({ fetchConnectorManifest: async () => ({ latestVersion: '1.0.0' }) });
    await assert.rejects(
      updateConnector({ name: '@onyxlabs/stripe', vault, registryClient, shipHome }),
      /is not installed/,
    );
  });
});

test('Installer: uninstallConnector wipes both the local source and the connector\'s Vault role', async () => {
  await withInstall(async ({ shipHome, vault }) => {
    globalThis.__vendworksTestUninstallCalls = 0;
    const registryClient = fakeRegistry({
      manifests: { 'onyxlabs/stripe': { latestVersion: '1.0.0' } },
      sources: {
        'onyxlabs/stripe@1.0.0': { version: '1.0.0', entry: 'index.js', files: [{ path: 'index.js', contents: V1_SOURCE }] },
      },
    });
    const installResult = await installConnector({
      name: '@onyxlabs/stripe',
      vault,
      registryClient,
      shipHome,
      askSecret: async () => 'sk_test_123',
    });

    const result = await uninstallConnector({ name: '@onyxlabs/stripe', vault, shipHome });
    assert.equal(result.wiped, true);
    assert.equal(result.hookError, undefined);
    assert.equal(globalThis.__vendworksTestUninstallCalls, 1);

    assert.equal(existsSync(join(shipHome, 'vendors', 'onyxlabs', 'stripe')), false);
    await assert.rejects(vault.interface.read(installResult.role, 'apiKey'), /has not been declared/);
    assert.deepEqual(await listInstalledConnectors({ shipHome }), []);
  });
});

test('Installer: uninstallConnector still wipes everything even when the connector\'s own uninstall hook throws', async () => {
  await withInstall(async ({ shipHome, vault }) => {
    const registryClient = fakeRegistry({
      manifests: { 'onyxlabs/flaky': { latestVersion: '1.0.0' } },
      sources: {
        'onyxlabs/flaky@1.0.0': {
          version: '1.0.0',
          entry: 'index.js',
          files: [{ path: 'index.js', contents: V1_THROWING_UNINSTALL_SOURCE }],
        },
      },
    });
    await installConnector({ name: '@onyxlabs/flaky', vault, registryClient, shipHome, askSecret: async () => 'sk' });

    const result = await uninstallConnector({ name: '@onyxlabs/flaky', vault, shipHome });
    assert.match(result.hookError, /uninstall hook exploded/);
    assert.equal(existsSync(join(shipHome, 'vendors', 'onyxlabs', 'flaky')), false);
    assert.deepEqual(await vault.listRoles(), []);
  });
});

test('Installer: uninstallConnector on a connector that was never installed is a harmless no-op', async () => {
  await withInstall(async ({ shipHome, vault }) => {
    const result = await uninstallConnector({ name: '@onyxlabs/ghost', vault, shipHome });
    assert.deepEqual(result, { name: '@onyxlabs/ghost', role: connectorRole('@onyxlabs/ghost'), wiped: true, hookError: undefined });
  });
});

test('Installer: listInstalledConnectors reports every installed connector across publishers', async () => {
  await withInstall(async ({ shipHome, vault }) => {
    assert.deepEqual(await listInstalledConnectors({ shipHome }), []);

    const registryClient = fakeRegistry({
      manifests: {
        'onyxlabs/stripe': { latestVersion: '1.0.0' },
        'someoneelse/notion': { latestVersion: '3.0.0' },
      },
      sources: {
        'onyxlabs/stripe@1.0.0': { version: '1.0.0', entry: 'index.js', files: [{ path: 'index.js', contents: V1_SOURCE }] },
        'someoneelse/notion@3.0.0': {
          version: '3.0.0',
          entry: 'index.js',
          files: [{ path: 'index.js', contents: 'export const configSchema = {};\nexport async function register(ship) {}\n' }],
        },
      },
    });
    await installConnector({ name: '@onyxlabs/stripe', vault, registryClient, shipHome, askSecret: async () => 'sk' });
    await installConnector({ name: '@someoneelse/notion', vault, registryClient, shipHome });

    const installed = await listInstalledConnectors({ shipHome });
    assert.equal(installed.length, 2);
    assert.deepEqual(
      installed.map((entry) => entry.name).sort(),
      ['@onyxlabs/stripe', '@someoneelse/notion'],
    );
  });
});
