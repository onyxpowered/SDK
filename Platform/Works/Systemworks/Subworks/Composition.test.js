// SDK
// Designed & Built By onyxpowered.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request as httpsRequest } from 'node:https';
import { composeWorks } from './Composition.js';
import { createVault } from '../../../Vault/Vault.js';
import { createDaemonLogger } from './Logging.js';

// These tests spawn real child processes and sockets. Node's non-TTY stdout/stderr
// pipes are never auto-unref'd, so once this file has done enough real I/O the process
// can outlive its last test without a natural "done" signal -- force exit once every
// test has actually finished, preserving whatever exit code node:test already decided.
after(() => {
  setImmediate(() => process.exit(process.exitCode ?? 0));
});

const FULL_WORKS = Object.freeze([
  { name: 'Metalworks' },
  { name: 'Blockworks' },
  { name: 'Vendworks' },
]);

function killProcessGroupIfAlive(pid) {
  if (!pid) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {}
  try {
    process.kill(pid, 'SIGKILL');
  } catch {}
}

// The e2e fixtures use a hardcoded port. A crashed/force-killed process from an
// earlier run (or another test file) can be left bound to it, causing the next
// spawn to fail EADDRINUSE and enter a restart loop that looks like flakiness
// but is actually this. Clear the port before trusting it's free.
async function killAnyoneOnPort(port) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  try {
    const { stdout } = await execFileAsync('lsof', ['-ti', `:${port}`]);
    for (const pid of stdout.split('\n').map((line) => line.trim()).filter(Boolean)) {
      try {
        process.kill(Number(pid), 'SIGKILL');
      } catch {}
    }
  } catch {}
}

const E2E_APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '__fixtures__', 'e2e-app');

async function withTempShipHome(run) {
  const dir = await mkdtemp(join(tmpdir(), 'ship-composition-test-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function fetchInsecure(url) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { rejectUnauthorized: false, agent: false }, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        res.destroy();
        resolve({ statusCode: res.statusCode, body });
      });
    });
    req.once('error', reject);
    req.end();
  });
}

test('Composition: an empty works list composes nothing and reconciliation falls back to safe defaults', async () => {
  await withTempShipHome(async (shipHome) => {
    const vault = await createVault({ shipHome });
    const logger = createDaemonLogger(join(shipHome, 'logs', 'daemon.log'));
    const composition = await composeWorks({ vault, shipHome, logger, works: [] });
    try {
      assert.equal(composition.metalworks, null);
      assert.equal(composition.blockworks, null);
      assert.equal(composition.vendworks, null);
      assert.equal(composition.fingerprintCheck, null);
      assert.deepEqual(await composition.listKnownBlocks(), []);
    } finally {
      await composition.stop();
    }
  });
});

test('Composition: the full works list actually instantiates real Metalworks, Blockworks, and Vendworks', async () => {
  await withTempShipHome(async (shipHome) => {
    const vault = await createVault({ shipHome });
    const logger = createDaemonLogger(join(shipHome, 'logs', 'daemon.log'));
    const composition = await composeWorks({ vault, shipHome, logger, works: FULL_WORKS });
    try {
      assert.ok(composition.metalworks);
      assert.ok(composition.blockworks);
      assert.ok(composition.vendworks);
      assert.equal(typeof composition.fingerprintCheck, 'function');
      assert.deepEqual(await composition.listKnownBlocks(), []);
    } finally {
      await composition.stop();
    }
  });
});

test('Composition: deployApp actually spawns the real Block process, and Interworks Post-mode proxies real HTTP traffic to it', async () => {
  await withTempShipHome(async (shipHome) => {
    const vault = await createVault({ shipHome });
    const logger = createDaemonLogger(join(shipHome, 'logs', 'daemon.log'));
    const composition = await composeWorks({ vault, shipHome, logger, works: FULL_WORKS });
    let capturedPid;
    try {
      await killAnyoneOnPort(39191);
      const result = await composition.deployApp({
        appName: 'e2e-app',
        appRootDir: E2E_APP_DIR,
        mode: 'post',
        port: 0,
        hostname: '127.0.0.1',
      });

      assert.equal(result.appName, 'e2e-app');
      assert.equal(result.mode, 'post');
      assert.equal(result.entryBlock, 'web');
      assert.match(result.url, /^https:\/\/127\.0\.0\.1:\d+$/);

      const response = await fetchInsecure(result.url);
      assert.equal(response.statusCode, 200);
      assert.equal(response.body, 'hello from the ship end-to-end test app\n');

      const statusBeforeStop = composition.blockworks.getBlockStatus('e2e-app', 'web');
      assert.equal(statusBeforeStop.state, 'running');
      capturedPid = statusBeforeStop.pid;
      assert.ok(capturedPid);

      await composition.stopApp({ appName: 'e2e-app' });

      const statusAfterStop = composition.blockworks.getBlockStatus('e2e-app', 'web');
      assert.equal(statusAfterStop.state, 'stopped');

      await assert.rejects(() => fetchInsecure(result.url), { code: 'ECONNREFUSED' });

      assert.equal(composition.getDeployment('e2e-app'), undefined);
    } finally {
      await composition.stop();
      killProcessGroupIfAlive(capturedPid);
    }
  });
});

test('Composition: deployApp rejects a second deploy of the same appName while the first is still up', async () => {
  await withTempShipHome(async (shipHome) => {
    const vault = await createVault({ shipHome });
    const logger = createDaemonLogger(join(shipHome, 'logs', 'daemon.log'));
    const composition = await composeWorks({ vault, shipHome, logger, works: FULL_WORKS });
    try {
      await composition.deployApp({ appName: 'dup-app', appRootDir: E2E_APP_DIR, mode: 'post', port: 0 });
      await assert.rejects(
        () => composition.deployApp({ appName: 'dup-app', appRootDir: E2E_APP_DIR, mode: 'post', port: 0 }),
        /already deployed/,
      );
    } finally {
      const status = composition.blockworks.getBlockStatus('dup-app', 'web');
      await composition.stopApp({ appName: 'dup-app' }).catch(() => {});
      await composition.stop();
      killProcessGroupIfAlive(status?.pid);
    }
  });
});

async function withMockServices(run) {
  const { default: WebSocket } = await import('../../Interworks/Subworks/Vendors/Ws/index.js');
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => {
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const wss = new WebSocket.WebSocketServer({ server });
  const helloMessages = [];

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'hello') {
        helloMessages.push(message);
        ws.send(JSON.stringify({ type: 'helloAck', previewUrl: `https://mock.test/${message.appSlug}`, sessionId: 'mock-session' }));
        return;
      }
      if (message.type === 'request') {
        ws.send(JSON.stringify({
          type: 'response',
          id: message.id,
          statusCode: 200,
          headers: { 'content-type': 'text/plain' },
          body: Buffer.from('mock preview response').toString('base64'),
        }));
      }
    });
  });

  const port = server.address().port;
  try {
    await run({ port, helloMessages });
  } finally {
    wss.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('Composition: Preview mode connects a real tunnel to Services and returns the server-assigned preview URL', async () => {
  await withTempShipHome(async (shipHome) => {
    await withMockServices(async ({ port, helloMessages }) => {
      const originalServicesUrl = process.env.SHIP_SERVICES_URL;
      process.env.SHIP_SERVICES_URL = `http://127.0.0.1:${port}`;
      await killAnyoneOnPort(39191);
      const vault = await createVault({ shipHome });
      const logger = createDaemonLogger(join(shipHome, 'logs', 'daemon.log'));
      const composition = await composeWorks({ vault, shipHome, logger, works: FULL_WORKS });
      let capturedPid;
      try {
        await vault.interface.writeReserved('interworks/daemonToken', { token: 'test-token', accountId: 'acct-1' });

        const result = await composition.deployApp({ appName: 'preview-e2e-app', appRootDir: E2E_APP_DIR, mode: 'preview' });

        assert.equal(result.mode, 'preview');
        assert.equal(result.url, 'https://mock.test/preview-e2e-app');
        assert.equal(helloMessages.length, 1);
        assert.equal(helloMessages[0].token, 'test-token');
        assert.equal(helloMessages[0].appSlug, 'preview-e2e-app');

        // Preview mode serves this App under /preview-e2e-app, not its own
        // root -- the real spawned process must actually see that as
        // SHIP_BASE_PATH, not just have it computed and discarded somewhere
        // in Composition.
        const logs = await composition.blockworks.readLogs('preview-e2e-app', 'web', 20);
        assert.ok(
          logs.some((entry) => entry.line === 'SHIP_BASE_PATH=/preview-e2e-app'),
          `expected the spawned process to see SHIP_BASE_PATH=/preview-e2e-app, got: ${JSON.stringify(logs)}`,
        );

        const statusBeforeStop = composition.blockworks.getBlockStatus('preview-e2e-app', 'web');
        capturedPid = statusBeforeStop.pid;

        await composition.stopApp({ appName: 'preview-e2e-app' });
        assert.equal(composition.getDeployment('preview-e2e-app'), undefined);
      } finally {
        await composition.stop();
        killProcessGroupIfAlive(capturedPid);
        if (originalServicesUrl === undefined) {
          delete process.env.SHIP_SERVICES_URL;
        } else {
          process.env.SHIP_SERVICES_URL = originalServicesUrl;
        }
      }
    });
  });
});

test('Composition: Preview and Production modes fail loud with a clear message instead of silently hanging', async () => {
  await withTempShipHome(async (shipHome) => {
    const vault = await createVault({ shipHome });
    const logger = createDaemonLogger(join(shipHome, 'logs', 'daemon.log'));
    const composition = await composeWorks({ vault, shipHome, logger, works: FULL_WORKS });
    try {
      await assert.rejects(
        () => composition.deployApp({ appName: 'preview-app', appRootDir: E2E_APP_DIR, mode: 'preview' }),
        /sdk login/,
      );
      await assert.rejects(
        () => composition.deployApp({ appName: 'production-app', appRootDir: E2E_APP_DIR, mode: 'production' }),
        /real domain/,
      );
    } finally {
      await composition.stop();
    }
  });
});
