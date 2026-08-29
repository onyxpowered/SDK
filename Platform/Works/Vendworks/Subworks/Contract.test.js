// Ship
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConnector, requiredConfigKeys, parseConnectorName } from './Contract.js';

test('Contract: validateConnector requires a register(ship) function', () => {
  assert.throws(() => validateConnector({}), /must export a register\(ship\) function/);
  assert.throws(() => validateConnector({ register: 'nope' }), /must export a register\(ship\) function/);
});

test('Contract: validateConnector accepts a minimal connector', () => {
  assert.equal(validateConnector({ register: async () => {} }), true);
});

test('Contract: validateConnector rejects a non-object configSchema', () => {
  assert.throws(
    () => validateConnector({ register: async () => {}, configSchema: 'nope' }),
    /configSchema must be an object/,
  );
});

test('Contract: validateConnector accepts an object configSchema', () => {
  assert.equal(
    validateConnector({ register: async () => {}, configSchema: { apiKey: 'the key' } }),
    true,
  );
});

test('Contract: validateConnector rejects a non-function lifecycle hook', () => {
  for (const hook of ['install', 'uninstall', 'update']) {
    assert.throws(
      () => validateConnector({ register: async () => {}, [hook]: 'nope' }),
      new RegExp(`${hook} hook must be a function`),
    );
  }
});

test('Contract: validateConnector accepts all three optional lifecycle hooks', () => {
  assert.equal(
    validateConnector({
      register: async () => {},
      install: async () => {},
      uninstall: async () => {},
      update: async () => {},
    }),
    true,
  );
});

test('Contract: requiredConfigKeys returns every declared configSchema key', () => {
  assert.deepEqual(
    requiredConfigKeys({ register: async () => {}, configSchema: { apiKey: '', apiSecret: '' } }),
    ['apiKey', 'apiSecret'],
  );
});

test('Contract: requiredConfigKeys returns an empty array when there is no configSchema', () => {
  assert.deepEqual(requiredConfigKeys({ register: async () => {} }), []);
});

test('Contract: parseConnectorName splits a valid @publisher/name into its parts', () => {
  assert.deepEqual(parseConnectorName('@onyxlabs/stripe-payments'), {
    publisher: 'onyxlabs',
    connector: 'stripe-payments',
  });
});

test('Contract: parseConnectorName rejects a name missing the @publisher namespace', () => {
  assert.throws(() => parseConnectorName('stripe'), /must be @publisher\/name/);
});

test('Contract: parseConnectorName rejects uppercase characters', () => {
  assert.throws(() => parseConnectorName('@OnyxLabs/Stripe'), /must be @publisher\/name/);
});

test('Contract: parseConnectorName rejects a nested or malformed namespace', () => {
  assert.throws(() => parseConnectorName('@onyxlabs/stripe/extra'), /must be @publisher\/name/);
  assert.throws(() => parseConnectorName('@/stripe'), /must be @publisher\/name/);
  assert.throws(() => parseConnectorName('@onyxlabs/'), /must be @publisher\/name/);
});
