// Ship
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnforcedVault } from './Enforcement.js';

function fakeVaultInterface() {
  const store = new Map();
  const calls = [];
  return {
    calls,
    async read(role, path) {
      calls.push(['read', role, path]);
      return store.get(`${role}/${path}`);
    },
    async write(role, path, value) {
      calls.push(['write', role, path, value]);
      store.set(`${role}/${path}`, value);
    },
  };
}

test('Enforcement: reads and writes on a declared path pass through to the real Vault interface', async () => {
  const vaultInterface = fakeVaultInterface();
  const enforced = createEnforcedVault({
    vaultInterface,
    role: 'connector__onyxlabs__stripe',
    declaredPaths: ['apiKey'],
    connectorName: '@onyxlabs/stripe',
  });
  await enforced.write('apiKey', 'sk_live_123');
  const value = await enforced.read('apiKey');
  assert.equal(value, 'sk_live_123');
  assert.deepEqual(vaultInterface.calls, [
    ['write', 'connector__onyxlabs__stripe', 'apiKey', 'sk_live_123'],
    ['read', 'connector__onyxlabs__stripe', 'apiKey'],
  ]);
});

test('Enforcement: reading an undeclared path throws and never touches the real Vault interface', async () => {
  const vaultInterface = fakeVaultInterface();
  const enforced = createEnforcedVault({
    vaultInterface,
    role: 'connector__onyxlabs__stripe',
    declaredPaths: ['apiKey'],
    connectorName: '@onyxlabs/stripe',
  });
  await assert.rejects(
    enforced.read('someOtherSecret'),
    /connector "@onyxlabs\/stripe" attempted to access undeclared Vault path "someOtherSecret"/,
  );
  assert.deepEqual(vaultInterface.calls, []);
});

test('Enforcement: writing an undeclared path throws and never touches the real Vault interface', async () => {
  const vaultInterface = fakeVaultInterface();
  const enforced = createEnforcedVault({
    vaultInterface,
    role: 'connector__onyxlabs__stripe',
    declaredPaths: ['apiKey'],
    connectorName: '@onyxlabs/stripe',
  });
  await assert.rejects(enforced.write('adminToken', 'x'), /undeclared Vault path "adminToken"/);
  assert.deepEqual(vaultInterface.calls, []);
});

test('Enforcement: an empty declaredPaths list rejects every path', async () => {
  const vaultInterface = fakeVaultInterface();
  const enforced = createEnforcedVault({
    vaultInterface,
    role: 'connector__onyxlabs__noop',
    declaredPaths: [],
    connectorName: '@onyxlabs/noop',
  });
  await assert.rejects(enforced.read('anything'), /\(declared paths: none\)/);
});

test('Enforcement: the returned handle exposes only read and write, never role administration', () => {
  const vaultInterface = fakeVaultInterface();
  const enforced = createEnforcedVault({
    vaultInterface,
    role: 'connector__onyxlabs__stripe',
    declaredPaths: ['apiKey'],
    connectorName: '@onyxlabs/stripe',
  });
  assert.deepEqual(Object.keys(enforced).sort(), ['read', 'write']);
  assert.ok(Object.isFrozen(enforced));
});

test('Enforcement: requires a Vault interface exposing read and write', () => {
  assert.throws(
    () => createEnforcedVault({ vaultInterface: {}, role: 'connector__a__b', declaredPaths: [] }),
    /requires a Vault interface/,
  );
});

test('Enforcement: requires a role', () => {
  const vaultInterface = fakeVaultInterface();
  assert.throws(() => createEnforcedVault({ vaultInterface, role: '', declaredPaths: [] }), /requires a role/);
});
