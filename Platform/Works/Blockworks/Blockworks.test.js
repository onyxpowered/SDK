// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBlockworks, VERSION } from './Blockworks.js';
import { VERSION as SUBWORKS_VERSION } from './Subworks/Version.js';
import { REQUIRED_VERSIONS } from '../Systemworks/Subworks/RequiredVersions.js';
import { createTick, createSystemSample } from '../Metalworks/Subworks/Schema.js';

function fakeChild(pid) {
  const emitter = new EventEmitter();
  emitter.pid = pid;
  return emitter;
}

function fakeSpawner() {
  let nextPid = 5000;
  const calls = [];
  const spawnFn = (command, options) => {
    const child = fakeChild(nextPid++);
    calls.push({ command, options, child });
    return child;
  };
  return { spawnFn, calls };
}

function fakeStateStore() {
  const data = new Map();
  return {
    async writeBlockState(appName, blockName, record) {
      data.set(`${appName}:${blockName}`, record);
    },
    async listAllKnownBlocks() {
      return [...data.entries()].map(([key, record]) => {
        const [appName, blockName] = key.split(':');
        return { appName, blockName, ...record };
      });
    },
  };
}

function fakeTelemetrySource() {
  return {
    async getTick() {
      const system = createSystemSample(10, 1000, 100, 900, 0);
      return createTick(process.hrtime.bigint(), system, {}, 'ok', 'ok');
    },
  };
}

async function withTempAppDir(run) {
  const dir = await mkdtemp(join(tmpdir(), 'ship-blockworks-test-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function withTempShipHome(run) {
  const dir = await mkdtemp(join(tmpdir(), 'ship-home-test-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('Blockworks: VERSION matches Subworks/Version.js and RequiredVersions.js', () => {
  assert.equal(VERSION, SUBWORKS_VERSION);
  assert.equal(VERSION, REQUIRED_VERSIONS.Blockworks);
});

test('Blockworks: deployApp loads a real ship.config.js and brings its Blocks to running', async () => {
  await withTempAppDir(async (appDir) => {
    await writeFile(
      join(appDir, 'ship.config.js'),
      "export default { blocks: { web: { command: 'node server.js', expose: true } } };\n",
    );
    const { spawnFn, calls } = fakeSpawner();
    const blockworks = await createBlockworks({
      stateStore: fakeStateStore(),
      telemetrySource: fakeTelemetrySource(),
      spawnFn,
    });
    const config = await blockworks.deployApp('my-app', appDir);
    assert.equal(config.blocks.web.command, 'node server.js');
    assert.equal(calls.length, 1);
    assert.equal(blockworks.getBlockStatus('my-app', 'web').state, 'running');
  });
});

test('Blockworks: deployApp propagates a ship.config.js validation failure', async () => {
  await withTempAppDir(async (appDir) => {
    await writeFile(join(appDir, 'ship.config.js'), 'export default { blocks: {} };\n');
    const blockworks = await createBlockworks({
      stateStore: fakeStateStore(),
      telemetrySource: fakeTelemetrySource(),
      spawnFn: fakeSpawner().spawnFn,
    });
    await assert.rejects(() => blockworks.deployApp('my-app', appDir), /at least one Block/);
  });
});

test('Blockworks: getAppStatus and stopApp delegate through to the underlying Supervisor', async () => {
  await withTempAppDir(async (appDir) => {
    await writeFile(
      join(appDir, 'ship.config.js'),
      "export default { blocks: { web: { command: 'node server.js' }, worker: { command: 'node worker.js', dependsOn: ['web'] } } };\n",
    );
    const { spawnFn } = fakeSpawner();
    const blockworks = await createBlockworks({
      stateStore: fakeStateStore(),
      telemetrySource: fakeTelemetrySource(),
      spawnFn,
      killFn: () => {},
      gracePeriodMs: 20,
    });
    await blockworks.deployApp('my-app', appDir);
    const status = blockworks.getAppStatus('my-app');
    assert.deepEqual(Object.keys(status).sort(), ['web', 'worker']);

    const order = await blockworks.stopApp('my-app');
    assert.deepEqual(order, ['worker', 'web']);
    assert.equal(blockworks.getBlockStatus('my-app', 'web').state, 'stopped');
  });
});

test('Blockworks: startPolling/stopPolling delegate through to the Supervisor poll loop', async () => {
  let tickCount = 0;
  let capturedDelay;
  const scheduler = {
    setTimeoutFn: (cb, ms) => {
      capturedDelay = ms;
      return 1;
    },
    clearTimeoutFn: () => {},
  };
  const blockworks = await createBlockworks({
    stateStore: fakeStateStore(),
    telemetrySource: { getTick: async () => { tickCount += 1; throw new Error('unused'); } },
    spawnFn: fakeSpawner().spawnFn,
    setTimeoutFn: scheduler.setTimeoutFn,
    clearTimeoutFn: scheduler.clearTimeoutFn,
    tickIntervalMs: 250,
  });
  blockworks.startPolling();
  assert.equal(capturedDelay, 250);
  blockworks.stopPolling();
  assert.equal(tickCount, 0);
});

test('Blockworks: listKnownBlocks reads back what deployApp recorded in the state store', async () => {
  await withTempAppDir(async (appDir) => {
    await writeFile(
      join(appDir, 'ship.config.js'),
      "export default { blocks: { web: { command: 'node server.js' } } };\n",
    );
    const { spawnFn } = fakeSpawner();
    const blockworks = await createBlockworks({
      stateStore: fakeStateStore(),
      telemetrySource: fakeTelemetrySource(),
      spawnFn,
    });
    await blockworks.deployApp('my-app', appDir);
    const known = await blockworks.listKnownBlocks();
    assert.equal(known.length, 1);
    assert.equal(known[0].appName, 'my-app');
    assert.equal(known[0].blockName, 'web');
    assert.equal(known[0].state, 'running');
  });
});

test('Blockworks: with no injected stateStore, it creates a real one under shipHome/blockworks', async () => {
  await withTempShipHome(async (shipHome) => {
    await withTempAppDir(async (appDir) => {
      await writeFile(
        join(appDir, 'ship.config.js'),
        "export default { blocks: { web: { command: 'node server.js' } } };\n",
      );
      const { spawnFn } = fakeSpawner();
      const blockworks = await createBlockworks({
        shipHome,
        telemetrySource: fakeTelemetrySource(),
        spawnFn,
      });
      await blockworks.deployApp('my-app', appDir);
      const known = await blockworks.listKnownBlocks();
      assert.equal(known.length, 1);
      assert.equal(known[0].state, 'running');

      const { existsSync } = await import('node:fs');
      assert.ok(existsSync(join(shipHome, 'blockworks', 'my-app', 'web.json')));
    });
  });
});
