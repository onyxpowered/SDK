// Ship
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectorRole, connectorRoleFromParts } from './Roles.js';
import { createVault } from '../../../Vault/Vault.js';

test('Roles: connectorRoleFromParts joins publisher and connector under a connector__ prefix', () => {
  assert.equal(connectorRoleFromParts('onyxlabs', 'stripe'), 'connector__onyxlabs__stripe');
});

test('Roles: connectorRoleFromParts rejects empty publisher or connector', () => {
  assert.throws(() => connectorRoleFromParts('', 'stripe'), /non-empty publisher/);
  assert.throws(() => connectorRoleFromParts('onyxlabs', ''), /non-empty connector/);
});

test('Roles: connectorRole parses @publisher/name and derives the same role', () => {
  assert.equal(connectorRole('@onyxlabs/stripe'), 'connector__onyxlabs__stripe');
});

test('Roles: connectorRole rejects a non-namespaced connector name', () => {
  assert.throws(() => connectorRole('stripe'), /must be @publisher\/name/);
});

test('Roles: connectorRole rejects uppercase in the connector name before a role is ever constructed', () => {
  assert.throws(() => connectorRole('@OnyxLabs/Stripe'), /must be @publisher\/name/);
});

test('Roles: a derived connector role is accepted by Vault\'s real hardened role validation', async () => {
  const shipHome = await mkdtemp(join(tmpdir(), 'vendworks-roles-'));
  try {
    const vault = await createVault({ shipHome });
    const role = connectorRole('@onyxlabs/stripe-payments');
    await assert.doesNotReject(vault.interface.declareRole(role));
    await assert.doesNotReject(vault.interface.write(role, 'ping', 'pong'));
    assert.equal(await vault.interface.read(role, 'ping'), 'pong');
  } finally {
    await rm(shipHome, { recursive: true, force: true });
  }
});

test('Roles: distinct publishers never collide into the same role string', () => {
  const a = connectorRole('@foo/bar');
  const b = connectorRole('@foo-bar/baz');
  assert.notEqual(a, b);
});

test('Roles: the __ separator can never be swallowed by a hyphenated boundary shift', () => {
  const a = connectorRole('@foo/bar-baz');
  const b = connectorRole('@foo-bar/baz');
  assert.notEqual(a, b);
});
