// SDK
// Designed & Built By onyxpowered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scaffoldNewApp } from './Scaffold.js';

test('scaffoldNewApp: creates index.js, package.json, and ship.config.js', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ship-new-'));
  const dest = join(parent, 'my-app');
  const result = await scaffoldNewApp('my-app', dest);
  assert.equal(result.appName, 'my-app');
  assert.ok(existsSync(join(dest, 'index.js')));
  assert.ok(existsSync(join(dest, 'package.json')));
  assert.ok(existsSync(join(dest, 'ship.config.js')));
});

test('scaffoldNewApp: generated ship.config.js is valid against the real ConfigSchema validator', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ship-new-'));
  const dest = join(parent, 'valid-app');
  await scaffoldNewApp('valid-app', dest);
  const { validateShipConfig } = await import('../../Blockworks/Subworks/ConfigSchema.js');
  const configModule = await import(`${dest}/ship.config.js`);
  assert.doesNotThrow(() => validateShipConfig(configModule.default));
});

test('scaffoldNewApp: the scaffolded app actually boots and serves a real HTTP response', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ship-new-'));
  const dest = join(parent, 'live-app');
  await scaffoldNewApp('live-app', dest);
  const { spawn } = await import('node:child_process');
  const child = spawn('node', ['index.js'], { cwd: dest, env: { ...process.env, PORT: '39217' } });
  try {
    await new Promise((resolve) => setTimeout(resolve, 400));
    const response = await fetch('http://127.0.0.1:39217');
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.equal(text, 'Shipped.');
  } finally {
    child.kill();
  }
});

test('scaffoldNewApp: rejects when the destination already exists', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ship-new-'));
  const dest = join(parent, 'dup-app');
  await scaffoldNewApp('dup-app', dest);
  await assert.rejects(() => scaffoldNewApp('dup-app', dest), /already exists/);
});

test('scaffoldNewApp: requires a non-empty app name', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ship-new-'));
  await assert.rejects(() => scaffoldNewApp('', join(parent, 'x')), /requires an app name/);
});
