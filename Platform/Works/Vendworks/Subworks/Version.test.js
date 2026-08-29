// Ship
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from './Version.js';

test('Version: VERSION is a semver-shaped string', () => {
  assert.equal(typeof VERSION, 'string');
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
});
