// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { sendIpcRequest } from './Subworks/IPC.js';
import { socketPath, pidFilePath, daemonLogPath } from '../../Paths.js';

const harnessPath = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'DaemonHarness.js');

async function withTempShipHome(run) {
  const dir = await mkdtemp(join(tmpdir(), 'ship-daemon-lifecycle-test-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function spawnHarness(shipHome) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [harnessPath], {
      env: { ...process.env, SHIP_HOME: shipHome },
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('daemon harness never signalled ready'));
    }, 10000);
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      if (stdout.includes('daemon-harness-ready')) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function waitForExit(child, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('child did not exit in time')), timeoutMs);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

test('DaemonLifecycle: IPC "ping" responds correctly against a real child-process daemon', async () => {
  await withTempShipHome(async (shipHome) => {
    const child = await spawnHarness(shipHome);
    try {
      const result = await sendIpcRequest(socketPath(shipHome), { type: 'ping' });
      assert.deepEqual(result, { pong: true });
    } finally {
      child.kill();
      await waitForExit(child).catch(() => {});
    }
  });
});

test('DaemonLifecycle: IPC "shutdown" goes through the same graceful path as SIGINT/SIGTERM -- process exits, PID file removed, shutdown logged', async () => {
  await withTempShipHome(async (shipHome) => {
    const child = await spawnHarness(shipHome);
    assert.ok(existsSync(pidFilePath(shipHome)));

    const ackPromise = sendIpcRequest(socketPath(shipHome), { type: 'shutdown' });
    const ack = await ackPromise;
    assert.deepEqual(ack, { shuttingDown: true });

    const exitCode = await waitForExit(child);
    assert.equal(exitCode, 0);

    assert.equal(existsSync(pidFilePath(shipHome)), false);

    const logRaw = await readFile(daemonLogPath(shipHome), 'utf8');
    assert.ok(logRaw.includes('daemon shutting down'));
    assert.ok(logRaw.includes('ipc-shutdown'));
  });
});
