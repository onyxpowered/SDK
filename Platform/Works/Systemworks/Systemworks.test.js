// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDaemon, VERSION } from './Systemworks.js';
import { createVault } from '../../Vault/Vault.js';
import { dispatch } from './Subworks/CLI.js';
import { sendIpcRequest } from './Subworks/IPC.js';
import { socketPath, daemonLogPath, pidFilePath } from '../../Paths.js';

async function withTempShipHome(run) {
  const dir = await mkdtemp(join(tmpdir(), 'ship-systemworks-test-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('Systemworks: daemon boots, writes a PID file, and answers version over IPC', async () => {
  await withTempShipHome(async (shipHome) => {
    const vault = await createVault({ shipHome });
    const { server } = await runDaemon({ vault, works: [], shipHome });
    try {
      assert.ok(existsSync(pidFilePath(shipHome)));

      const ctx = { shipHome, socketPath: socketPath(shipHome), version: VERSION };
      const result = await dispatch(['version'], ctx);
      assert.equal(result.source, 'daemon');
      assert.equal(result.version, VERSION);

      const pid = await vault.interface.readReserved('daemon/pid');
      assert.equal(pid, process.pid);
    } finally {
      server.close();
    }
  });
});

test('Systemworks: daemon writes structured log lines that ship logs can read back', async () => {
  await withTempShipHome(async (shipHome) => {
    const vault = await createVault({ shipHome });
    const { server } = await runDaemon({ vault, works: [], shipHome });
    try {
      assert.ok(existsSync(daemonLogPath(shipHome)));
      const ctx = { shipHome };
      const lines = await dispatch(['logs'], ctx);
      assert.ok(lines.length > 0);
      assert.ok(lines.some((entry) => entry.message === 'daemon ready'));
    } finally {
      server.close();
    }
  });
});

test('Systemworks: every IPC request is logged with its type and duration, success or failure', async () => {
  await withTempShipHome(async (shipHome) => {
    const vault = await createVault({ shipHome });
    const { server } = await runDaemon({ vault, works: [], shipHome });
    try {
      const ctx = { shipHome, socketPath: socketPath(shipHome), version: VERSION };
      await dispatch(['version'], ctx);
      await sendIpcRequest(socketPath(shipHome), { type: 'nonexistent-request-type' }).catch(() => {});

      const lines = await dispatch(['logs'], { shipHome });
      const ok = lines.find((entry) => entry.message === 'ipc request' && entry.type === 'version');
      assert.ok(ok, 'expected a successful "ipc request" log entry for the version call');
      assert.equal(typeof ok.durationMs, 'number');

      const failed = lines.find((entry) => entry.message === 'ipc request failed' && entry.type === 'nonexistent-request-type');
      assert.ok(failed, 'expected a failed "ipc request failed" log entry for the bad request type');
      assert.match(failed.error, /unknown IPC request type/);
    } finally {
      server.close();
    }
  });
});

test('Systemworks: runDaemon({ verbose: true }) tees log entries to stdout; the default stays silent', async () => {
  await withTempShipHome(async (shipHome) => {
    const originalLog = console.log;
    const printed = [];
    console.log = (...args) => printed.push(args.join(' '));
    let server;
    try {
      const vault = await createVault({ shipHome });
      ({ server } = await runDaemon({ vault, works: [], shipHome, verbose: true }));
    } finally {
      console.log = originalLog;
    }
    try {
      assert.ok(printed.some((line) => line.includes('daemon ready')));
    } finally {
      server.close();
    }
  });
});

test('Systemworks: runDaemon with no verbose option stays silent on stdout (default, unchanged)', async () => {
  await withTempShipHome(async (shipHome) => {
    const originalLog = console.log;
    const printed = [];
    console.log = (...args) => printed.push(args.join(' '));
    let server;
    try {
      const vault = await createVault({ shipHome });
      ({ server } = await runDaemon({ vault, works: [], shipHome }));
    } finally {
      console.log = originalLog;
    }
    try {
      assert.deepEqual(printed, []);
    } finally {
      server.close();
    }
  });
});

test('Systemworks: CLI version command falls back to local version when no daemon is running', async () => {
  await withTempShipHome(async (shipHome) => {
    const ctx = { shipHome, socketPath: socketPath(shipHome), version: VERSION };
    const result = await dispatch(['version'], ctx);
    assert.equal(result.source, 'cli');
    assert.equal(result.version, VERSION);
  });
});

test('Systemworks: reconciliation runs with no known Blocks and does not throw', async () => {
  await withTempShipHome(async (shipHome) => {
    const vault = await createVault({ shipHome });
    const { server, reconciliationResult } = await runDaemon({ vault, works: [], shipHome });
    try {
      assert.deepEqual(reconciliationResult, { reattached: [], stale: [] });
    } finally {
      server.close();
    }
  });
});

test('Systemworks: runDaemon actually uses injected reconciliation collaborators, not the defaults', async () => {
  await withTempShipHome(async (shipHome) => {
    const vault = await createVault({ shipHome });
    const knownBlock = { pid: 4242, name: 'web' };
    const listKnownBlocks = async () => [knownBlock];
    const fingerprintCheck = async (block) => block.pid === 4242;
    const { server, reconciliationResult } = await runDaemon({
      vault,
      works: [],
      shipHome,
      reconciliation: { listKnownBlocks, fingerprintCheck },
    });
    try {
      assert.deepEqual(reconciliationResult, { reattached: [knownBlock], stale: [] });
    } finally {
      server.close();
    }
  });
});

test('Systemworks: IPC ping request type responds over a live daemon socket', async () => {
  await withTempShipHome(async (shipHome) => {
    const vault = await createVault({ shipHome });
    const { server, socket } = await runDaemon({ vault, works: [], shipHome });
    try {
      const result = await sendIpcRequest(socket, { type: 'ping' });
      assert.deepEqual(result, { pong: true });
    } finally {
      server.close();
    }
  });
});

test('Systemworks: shutdown() closes the server and removes the PID file, callable directly without a real OS signal', async () => {
  await withTempShipHome(async (shipHome) => {
    const vault = await createVault({ shipHome });
    const { shutdown } = await runDaemon({ vault, works: [], shipHome });
    assert.ok(existsSync(pidFilePath(shipHome)));
    await shutdown('test-direct-call');
    assert.equal(existsSync(pidFilePath(shipHome)), false);
  });
});

test('Systemworks: shutdown() is idempotent when called more than once', async () => {
  await withTempShipHome(async (shipHome) => {
    const vault = await createVault({ shipHome });
    const { shutdown } = await runDaemon({ vault, works: [], shipHome });
    await shutdown('first');
    await shutdown('second');
  });
});
