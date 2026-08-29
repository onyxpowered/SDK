// SDK
// Designed & Built By onyxpowered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODES, MODE_NAMES, isValidMode, resolveInterworksTarget } from './Mode.js';

test('MODES exposes exactly Post, Preview, Production', () => {
  assert.deepEqual([...MODE_NAMES].sort(), ['post', 'preview', 'production']);
  assert.equal(MODES.POST, 'post');
  assert.equal(MODES.PREVIEW, 'preview');
  assert.equal(MODES.PRODUCTION, 'production');
});

test('isValidMode accepts only the three defined modes', () => {
  assert.equal(isValidMode(MODES.POST), true);
  assert.equal(isValidMode('staging'), false);
});

test('resolveInterworksTarget rejects an unknown mode', () => {
  const config = { blocks: { web: { command: 'node server.js' } } };
  assert.throws(() => resolveInterworksTarget('my-app', config, 'staging'), /unknown Interworks mode/);
});

test('resolveInterworksTarget resolves the sole Block as the entry Block when only one exists', () => {
  const config = { blocks: { web: { command: 'node server.js' } } };
  const target = resolveInterworksTarget('my-app', config, MODES.POST);
  assert.equal(target.entryBlockName, 'web');
  assert.equal(target.entryBlock.command, 'node server.js');
  assert.equal(target.mode, MODES.POST);
});

test('resolveInterworksTarget resolves the explicitly exposed Block among several', () => {
  const config = {
    blocks: {
      web: { command: 'node server.js', expose: true },
      worker: { command: 'node worker.js', dependsOn: ['web'] },
    },
  };
  const target = resolveInterworksTarget('my-app', config, MODES.PREVIEW);
  assert.equal(target.entryBlockName, 'web');
});

test('resolveInterworksTarget throws when multiple Blocks exist and none is exposed', () => {
  const config = {
    blocks: {
      web: { command: 'node server.js' },
      worker: { command: 'node worker.js' },
    },
  };
  assert.throws(
    () => resolveInterworksTarget('my-app', config, MODES.POST),
    /declares no exposed Block/,
  );
});

test('resolveInterworksTarget throws when more than one Block is exposed', () => {
  const config = {
    blocks: {
      web: { command: 'node server.js', expose: true },
      admin: { command: 'node admin.js', expose: true },
    },
  };
  assert.throws(
    () => resolveInterworksTarget('my-app', config, MODES.POST),
    /exposes more than one Block/,
  );
});

test('resolveInterworksTarget re-validates the config and surfaces schema errors', () => {
  const badConfig = { blocks: {} };
  assert.throws(() => resolveInterworksTarget('my-app', badConfig, MODES.POST));
});

test('resolveInterworksTarget slugifies the App name for use in a preview path', () => {
  const config = { blocks: { web: { command: 'node server.js' } } };
  const target = resolveInterworksTarget('My First Project!', config, MODES.PREVIEW);
  assert.equal(target.appSlug, 'my-first-project');
});
