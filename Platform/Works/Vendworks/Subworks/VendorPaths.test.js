// Ship
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { vendorsRootDir, connectorVendorDir, connectorMetadataPath } from './VendorPaths.js';

test('VendorPaths: vendorsRootDir nests a vendors directory under the given Ship home', () => {
  assert.equal(vendorsRootDir('/home/dev/.ship'), join('/home/dev/.ship', 'vendors'));
});

test('VendorPaths: connectorVendorDir nests publisher then connector under vendors', () => {
  assert.equal(
    connectorVendorDir('onyxlabs', 'stripe', '/home/dev/.ship'),
    join('/home/dev/.ship', 'vendors', 'onyxlabs', 'stripe'),
  );
});

test('VendorPaths: connectorMetadataPath sits inside that connector\'s own vendor directory', () => {
  const metadataPath = connectorMetadataPath('onyxlabs', 'stripe', '/home/dev/.ship');
  const vendorDir = connectorVendorDir('onyxlabs', 'stripe', '/home/dev/.ship');
  assert.ok(metadataPath.startsWith(vendorDir));
  assert.ok(metadataPath.endsWith('.ship-connector.json'));
});

test('VendorPaths: two different connectors never share a vendor directory', () => {
  const a = connectorVendorDir('onyxlabs', 'stripe', '/home/dev/.ship');
  const b = connectorVendorDir('onyxlabs', 'stripe-two', '/home/dev/.ship');
  assert.notEqual(a, b);
});
