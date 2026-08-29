// SDK
// Designed & Built By onyxpowered.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatch, resolveCommand, main } from './CLI.js';
import { createVault } from '../../../Vault/Vault.js';
import { runDaemon } from '../Systemworks.js';
import { socketPath } from '../../../Paths.js';
import { getDaemonToken } from '../../Interworks/Interworks.js';

// The daemon tests below spawn real child processes and sockets. Node's non-TTY
// stdout/stderr pipes are never auto-unref'd, so once this file has done enough real
// I/O, the process can outlive its last test without a natural "done" signal -- force
// exit once every test has actually finished, preserving whatever exit code node:test
// already decided (0 on pass, 1 on failure).
after(() => {
  setImmediate(() => process.exit(process.exitCode ?? 0));
});

const E2E_APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '__fixtures__', 'e2e-app-cli');
const FULL_WORKS = Object.freeze([{ name: 'Metalworks' }, { name: 'Blockworks' }, { name: 'Vendworks' }]);

// runDaemon() attaches SIGINT/SIGTERM listeners that keep the process alive until a real
// signal or process.exit() -- correct for a real daemon, but this test process never sends
// itself either, so leftover listeners from an earlier runDaemon() call in this same file
// would otherwise block node --test from ever exiting on its own.
async function stopDaemonForTest(server, composition) {
  server.close();
  await composition.stop();
  process.removeAllListeners('SIGINT');
  process.removeAllListeners('SIGTERM');
}

async function withTempShipHome(run) {
  const dir = await mkdtemp(join(tmpdir(), 'ship-cli-test-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

// Same hardcoded-fixture-port issue as Composition.test.js -- a leftover process
// from an earlier run can block this test's spawn and look like flakiness.
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

async function withSlowMockServices(delayMs, run) {
  const { default: WebSocket } = await import('../../Interworks/Subworks/Vendors/Ws/index.js');
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => {
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const wss = new WebSocket.WebSocketServer({ server });

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'hello') {
        // Simulates real network/service latency -- longer than IPC.js's old
        // 5s default, shorter than deployApp's own 10s helloAck wait.
        setTimeout(() => {
          ws.send(JSON.stringify({ type: 'helloAck', previewUrl: `https://mock.test/${message.appSlug}`, sessionId: 'slow-session' }));
        }, delayMs);
      }
    });
  });

  const port = server.address().port;
  try {
    await run(port);
  } finally {
    wss.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('CLI: "deploy preview" survives a slow-but-legitimate Services round trip that used to exceed the IPC timeout', async () => {
  await withTempShipHome(async (shipHome) => {
    await withSlowMockServices(6000, async (mockPort) => {
      const originalServicesUrl = process.env.SHIP_SERVICES_URL;
      process.env.SHIP_SERVICES_URL = `http://127.0.0.1:${mockPort}`;
      await killAnyoneOnPort(39192);
      const vault = await createVault({ shipHome });
      const { server, composition } = await runDaemon({ vault, works: FULL_WORKS, shipHome });
      let capturedPid;
      try {
        await vault.interface.writeReserved('interworks/daemonToken', { token: 'test-token', accountId: 'acct-1' });
        const ctx = { socketPath: socketPath(shipHome) };

        const result = await dispatch(['deploy', 'preview', E2E_APP_DIR, '--name=slow-preview-app'], ctx);

        assert.equal(result.mode, 'preview');
        assert.equal(result.url, 'https://mock.test/slow-preview-app');

        const status = composition.blockworks.getBlockStatus('slow-preview-app', 'web');
        capturedPid = status.pid;
      } finally {
        await stopDaemonForTest(server, composition);
        if (capturedPid) {
          try {
            process.kill(-capturedPid, 'SIGKILL');
          } catch {}
          try {
            process.kill(capturedPid, 'SIGKILL');
          } catch {}
        }
        if (originalServicesUrl === undefined) {
          delete process.env.SHIP_SERVICES_URL;
        } else {
          process.env.SHIP_SERVICES_URL = originalServicesUrl;
        }
      }
    });
  });
});

test('CLI: "vault export" never reads a passphrase from a positional argument, only from the injected prompt', async () => {
  await withTempShipHome(async (shipHome) => {
    const destPath = join(shipHome, 'backup.json');
    let promptedWith = null;
    const ctx = {
      shipHome,
      promptPassphrase: async (text) => {
        promptedWith = text;
        return 'the-real-passphrase';
      },
    };
    const result = await dispatch(['vault', 'export', destPath], ctx);
    assert.equal(result.exported, destPath);
    assert.match(promptedWith, /export passphrase/i);

    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(destPath, 'utf8');
    assert.ok(!raw.includes('the-real-passphrase'));
  });
});

test('CLI: "vault export" treats the first argument as destPath, never as a passphrase, even if it looks like one', async () => {
  await withTempShipHome(async (shipHome) => {
    let usedPassphrase = null;
    const ctx = {
      shipHome,
      promptPassphrase: async () => {
        usedPassphrase = 'prompted-value';
        return usedPassphrase;
      },
    };
    const suspiciousLookingArg = 'not-a-passphrase-just-a-filename.json';
    const destPath = join(shipHome, suspiciousLookingArg);
    const result = await dispatch(['vault', 'export', destPath], ctx);
    assert.equal(result.exported, destPath);
    assert.equal(usedPassphrase, 'prompted-value');
  });
});

test('CLI: "vault import" requires a bundlePath argument and always prompts for the passphrase', async () => {
  await withTempShipHome(async (shipHomeA) => {
    await withTempShipHome(async (shipHomeB) => {
      const vaultA = await createVault({ shipHome: shipHomeA });
      await vaultA.interface.declareRole('r');
      await vaultA.interface.write('r', 'k', 'from-export');
      const bundlePath = join(shipHomeA, 'backup.json');
      await vaultA.export('shared-passphrase', bundlePath);

      let promptedWith = null;
      const ctx = {
        shipHome: shipHomeB,
        promptPassphrase: async (text) => {
          promptedWith = text;
          return 'shared-passphrase';
        },
      };
      const result = await dispatch(['vault', 'import', bundlePath], ctx);
      assert.equal(result.imported, bundlePath);
      assert.match(promptedWith, /import passphrase/i);

      const vaultB = await createVault({ shipHome: shipHomeB });
      const value = await vaultB.interface.read('r', 'k');
      assert.equal(value, 'from-export');
    });
  });
});

test('CLI: "vault import" fails loud with a usage error when no bundlePath is given', async () => {
  await withTempShipHome(async (shipHome) => {
    const ctx = { shipHome, promptPassphrase: async () => 'x' };
    await assert.rejects(() => dispatch(['vault', 'import'], ctx), /usage: sdk vault import/);
  });
});

test('CLI: resolveCommand routes every command from the Plan.txt section 17 surface this track built', () => {
  const cases = [
    [['version'], 'version'],
    [['new', 'my-app'], 'new'],
    [['import', 'gh:someone/repo'], 'import'],
    [['daemon', 'install'], 'daemon install'],
    [['daemon', 'uninstall'], 'daemon uninstall'],
    [['daemon', 'stop'], 'daemon stop'],
    [['daemon', 'status'], 'daemon status'],
    [['logs'], 'logs'],
    [['logs', 'my-app'], 'logs'],
    [['vault', 'export'], 'vault export'],
    [['vault', 'import'], 'vault import'],
    [['deploy'], 'deploy'],
    [['deploy', '/some/path'], 'deploy'],
    [['deploy', 'preview'], 'deploy preview'],
    [['deploy', 'production'], 'deploy production'],
    [['preview'], 'preview'],
    [['production'], 'production'],
    [['stop', 'my-app'], 'stop'],
    [['stop', 'my-app:worker'], 'stop'],
    [['connector', 'install'], 'connector install'],
    [['connector', 'uninstall'], 'connector uninstall'],
    [['connector', 'list'], 'connector list'],
    [['connector', 'publish'], 'connector publish'],
  ];
  for (const [argv, expectedKey] of cases) {
    const resolved = resolveCommand(argv);
    assert.ok(resolved, `expected "${argv.join(' ')}" to resolve to a command`);
    assert.equal(resolved.key, expectedKey, `argv ${JSON.stringify(argv)} resolved to "${resolved.key}", expected "${expectedKey}"`);
  }
});

test('CLI: "stop" requires an app target and reports the usage error', async () => {
  const ctx = { socketPath: '/dev/null/does-not-exist.sock' };
  await assert.rejects(() => dispatch(['stop'], ctx), /usage: sdk stop/);
});

test('CLI: "logs <app>:<block>" reads real captured Block output, empty before anything has run', async () => {
  await withTempShipHome(async (shipHome) => {
    const ctx = { shipHome };
    const result = await dispatch(['logs', 'my-app:worker'], ctx);
    assert.equal(result.appName, 'my-app');
    assert.equal(result.blockName, 'worker');
    assert.deepEqual(result.entries, []);
  });
});

test('CLI: "logs <app>" with no block name defaults to "web"', async () => {
  await withTempShipHome(async (shipHome) => {
    const ctx = { shipHome };
    const result = await dispatch(['logs', 'my-app'], ctx);
    assert.equal(result.blockName, 'web');
  });
});

test('CLI: "connector install" and "connector publish" fail loud with a usage error when required args are missing', async () => {
  await withTempShipHome(async (shipHome) => {
    const ctx = { shipHome };
    await assert.rejects(() => dispatch(['connector', 'install'], ctx), /usage: sdk connector install/);
    await assert.rejects(() => dispatch(['connector', 'publish'], ctx), /usage: sdk connector publish/);
  });
});

test('CLI: "new" requires an app name', async () => {
  const ctx = {};
  await assert.rejects(() => dispatch(['new'], ctx), /usage: sdk new/);
});

test('CLI: "new" scaffolds a real, deployable app under the home directory, regardless of cwd', async () => {
  // Deliberately chdir somewhere unrelated first -- "new" must resolve against
  // homedir(), never cwd, so running it from inside any repo (sdk's own or
  // otherwise) can never drop a starter project into that repo by accident.
  const scratch = await mkdtemp(join(tmpdir(), 'sdk-cli-new-cwd-'));
  const originalCwd = process.cwd();
  process.chdir(scratch);
  const appName = `sdk-cli-new-test-${Date.now()}`;
  const expectedRoot = join(homedir(), appName);
  try {
    const result = await dispatch(['new', appName], {});
    assert.equal(result.appName, appName);
    assert.equal(result.appRootDir, expectedRoot);
    const configModule = await import(`${result.appRootDir}/ship.config.js`);
    assert.equal(configModule.default.blocks.web.command, 'npm start');
  } finally {
    process.chdir(originalCwd);
    await rm(scratch, { recursive: true, force: true });
    await rm(expectedRoot, { recursive: true, force: true });
  }
});

test('CLI: "import" pulls a local path into the managed apps directory and auto-detects', async () => {
  await withTempShipHome(async (shipHome) => {
    const source = await mkdtemp(join(tmpdir(), 'ship-cli-import-src-'));
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(source, 'package.json'), JSON.stringify({ scripts: { start: 'node index.js' } }));
    const result = await dispatch(['import', source, '--name=imported-app'], { shipHome });
    assert.equal(result.appName, 'imported-app');
    assert.match(result.detected, /auto-detected/);
  });
});

test('CLI: "import --from=heroku" translates a Procfile through the real CLI command', async () => {
  await withTempShipHome(async (shipHome) => {
    const source = await mkdtemp(join(tmpdir(), 'ship-cli-import-heroku-'));
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(source, 'Procfile'), 'web: node server.js\n');
    const result = await dispatch(['import', source, '--from=heroku', '--name=heroku-import'], { shipHome });
    assert.match(result.detected, /heroku/);
  });
});

test('CLI: "connector list" runs end to end against a real (empty) Vendworks install directory', async () => {
  await withTempShipHome(async (shipHome) => {
    const ctx = { shipHome };
    const result = await dispatch(['connector', 'list'], ctx);
    assert.deepEqual(result, []);
  });
});

test('CLI: "login" posts credentials to Services and stores the returned token in Vault', async () => {
  await withTempShipHome(async (shipHome) => {
    let requestedUrl = null;
    let requestedBody = null;
    const ctx = {
      shipHome,
      promptCredentials: async () => ({ email: 'test@example.com', password: 'password123' }),
      fetchImpl: async (url, options) => {
        requestedUrl = url;
        requestedBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({ accountId: 'acct-1', email: 'test@example.com', token: 'the-token' }),
        };
      },
    };
    const result = await dispatch(['login'], ctx);
    assert.equal(result.loggedIn, true);
    assert.equal(result.accountId, 'acct-1');
    assert.match(requestedUrl, /\/api\/login$/);
    assert.deepEqual(requestedBody, { email: 'test@example.com', password: 'password123' });

    const vault = await createVault({ shipHome });
    const stored = await getDaemonToken(vault);
    assert.equal(stored.token, 'the-token');
    assert.equal(stored.accountId, 'acct-1');
  });
});

test('CLI: "login --signup" posts to the signup endpoint instead of login', async () => {
  await withTempShipHome(async (shipHome) => {
    let requestedUrl = null;
    const ctx = {
      shipHome,
      promptCredentials: async () => ({ email: 'new@example.com', password: 'password123' }),
      fetchImpl: async (url) => {
        requestedUrl = url;
        return { ok: true, status: 201, json: async () => ({ accountId: 'acct-2', email: 'new@example.com', token: 'signup-token' }) };
      },
    };
    await dispatch(['login', '--signup'], ctx);
    assert.match(requestedUrl, /\/api\/signup$/);
  });
});

test('CLI: "login" fails loud with the server\'s error message on a rejected login', async () => {
  await withTempShipHome(async (shipHome) => {
    const ctx = {
      shipHome,
      promptCredentials: async () => ({ email: 'wrong@example.com', password: 'bad' }),
      fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: 'invalid email or password' }) }),
    };
    await assert.rejects(() => dispatch(['login'], ctx), /invalid email or password/);
  });
});

test('CLI: real non-TTY "login" prompt reads both piped lines instead of hanging on the second', async () => {
  // Regression test for a real bug: readline/promises' question() can drop the
  // 'line' event for a second sequential prompt when stdin is a pipe with all
  // its data already buffered. This spawns the actual CLI (not a mocked
  // promptCredentials) with piped stdin -- exactly the failure mode.
  const { spawn } = await import('node:child_process');
  const shipHome = await mkdtemp(join(tmpdir(), 'ship-cli-login-tty-'));
  try {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./CLI.js', import.meta.url)), 'login', '--signup'], {
      env: { ...process.env, SHIP_HOME: shipHome, SHIP_SERVICES_URL: 'http://127.0.0.1:1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.write('nontty@example.com\nsomePassword123\n');
    child.stdin.end();
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    const exitCode = await new Promise((resolve) => child.on('close', resolve));
    // SHIP_SERVICES_URL deliberately points nowhere reachable -- the fetch
    // itself is expected to fail. What this test actually proves is that both
    // prompts resolved at all (the process reached the fetch and failed
    // there, rather than hanging forever on the second readline prompt).
    assert.equal(exitCode, 1);
    assert.match(stderr, /ECONNREFUSED|fetch failed/);
  } finally {
    await rm(shipHome, { recursive: true, force: true });
  }
});

test('CLI: "daemon start" prints a human-readable confirmation instead of nothing (which looks identical to a hang)', async () => {
  await withTempShipHome(async (shipHome) => {
    const originalShipHome = process.env.SHIP_HOME;
    process.env.SHIP_HOME = shipHome;
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    let readyReport;
    try {
      readyReport = await main(['daemon', 'start']);
    } finally {
      console.log = originalLog;
      if (originalShipHome === undefined) {
        delete process.env.SHIP_HOME;
      } else {
        process.env.SHIP_HOME = originalShipHome;
      }
      await readyReport?.shutdown?.();
    }

    assert.ok(logs.some((line) => line.includes('Ship daemon ready')), `expected a ready confirmation, got: ${JSON.stringify(logs)}`);
    assert.ok(logs.some((line) => line.includes(readyReport.socket)), 'expected the confirmation to include the actual socket path');
    assert.ok(logs.some((line) => line.includes('ctrl+c')), 'expected a hint that this blocks the terminal in the foreground');
  });
});

test('CLI: "daemon start --dev" announces verbose mode and tees internal daemon activity to stdout', async () => {
  await withTempShipHome(async (shipHome) => {
    const originalShipHome = process.env.SHIP_HOME;
    process.env.SHIP_HOME = shipHome;
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    let readyReport;
    try {
      readyReport = await main(['daemon', 'start', '--dev']);
    } finally {
      console.log = originalLog;
      if (originalShipHome === undefined) {
        delete process.env.SHIP_HOME;
      } else {
        process.env.SHIP_HOME = originalShipHome;
      }
      await readyReport?.shutdown?.();
    }

    assert.ok(logs.some((line) => line.includes('--dev')), 'expected the CLI to announce --dev mode explicitly');
    // "daemon ready" is itself one of the internal log entries verbose mode tees through.
    assert.ok(logs.some((line) => line.includes('daemon ready')), 'expected internal daemon log lines to reach stdout in --dev mode');
  });
});

test('CLI: "daemon start" without --dev never leaks internal log lines to stdout, only the two confirmation lines', async () => {
  await withTempShipHome(async (shipHome) => {
    const originalShipHome = process.env.SHIP_HOME;
    process.env.SHIP_HOME = shipHome;
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    let readyReport;
    try {
      readyReport = await main(['daemon', 'start']);
    } finally {
      console.log = originalLog;
      if (originalShipHome === undefined) {
        delete process.env.SHIP_HOME;
      } else {
        process.env.SHIP_HOME = originalShipHome;
      }
      await readyReport?.shutdown?.();
    }

    assert.equal(logs.length, 2, `expected exactly the two confirmation lines, got: ${JSON.stringify(logs)}`);
  });
});

test('CLI: full pipeline -- sdk new, then sdk deploy the exact thing it scaffolded, and it actually serves real HTTP', async () => {
  await withTempShipHome(async (shipHome) => {
    const scratch = await mkdtemp(join(tmpdir(), 'sdk-cli-fullpipeline-'));
    const originalCwd = process.cwd();
    process.chdir(scratch);
    // "new" resolves against homedir(), never cwd (see the dedicated test
    // above) -- so this app lands in the real home directory even though we
    // chdir'd into scratch; give it a unique name and clean it up explicitly.
    const appName = `sdk-cli-fullpipeline-app-${Date.now()}`;
    const appRoot = join(homedir(), appName);
    const vault = await createVault({ shipHome });
    const { server, composition } = await runDaemon({ vault, works: FULL_WORKS, shipHome });
    let capturedPid;
    try {
      const newResult = await dispatch(['new', appName], {});
      assert.equal(newResult.appName, appName);
      assert.equal(newResult.appRootDir, appRoot);

      const ctx = { socketPath: socketPath(shipHome) };
      const deployResult = await dispatch(['deploy', newResult.appRootDir, '--port=0'], ctx);
      assert.equal(deployResult.mode, 'post');

      const https = await import('node:https');
      const response = await new Promise((resolvePromise, reject) => {
        const req = https.request(deployResult.url, { rejectUnauthorized: false }, (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => resolvePromise({ statusCode: res.statusCode, body }));
        });
        req.once('error', reject);
        req.end();
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.body, 'Shipped.');

      const status = composition.blockworks.getBlockStatus(appName, 'web');
      capturedPid = status.pid;
    } finally {
      process.chdir(originalCwd);
      await rm(scratch, { recursive: true, force: true });
      await rm(appRoot, { recursive: true, force: true });
      await stopDaemonForTest(server, composition);
      if (capturedPid) {
        try {
          process.kill(-capturedPid, 'SIGKILL');
        } catch {}
        try {
          process.kill(capturedPid, 'SIGKILL');
        } catch {}
      }
    }
  });
});

test('CLI: "deploy" and "stop" round-trip through real IPC against a live daemon composed with Metalworks/Blockworks/Vendworks', async () => {
  await withTempShipHome(async (shipHome) => {
    const vault = await createVault({ shipHome });
    const { server, composition } = await runDaemon({ vault, works: FULL_WORKS, shipHome });
    let capturedPid;
    try {
      await killAnyoneOnPort(39192);
      const ctx = { socketPath: socketPath(shipHome) };
      const deployResult = await dispatch(
        ['deploy', E2E_APP_DIR, '--name=cli-e2e-app', '--port=0'],
        ctx,
      );
      assert.equal(deployResult.appName, 'cli-e2e-app');
      assert.equal(deployResult.mode, 'post');
      assert.match(deployResult.url, /^https:\/\/127\.0\.0\.1:\d+$/);

      const status = composition.blockworks.getBlockStatus('cli-e2e-app', 'web');
      assert.equal(status.state, 'running');
      capturedPid = status.pid;

      const logsResult = await dispatch(['logs', 'cli-e2e-app'], { shipHome });
      assert.ok(
        logsResult.entries.some((entry) => entry.line?.includes('e2e test app listening')),
        `expected real captured stdout from the deployed Block, got: ${JSON.stringify(logsResult.entries)}`,
      );
      assert.ok(logsResult.entries.every((entry) => entry.stream === 'stdout'), 'this fixture never writes to stderr');

      const stopResult = await dispatch(['stop', 'cli-e2e-app'], ctx);
      assert.deepEqual(stopResult, { appName: 'cli-e2e-app', stopped: true });

      const statusAfterStop = composition.blockworks.getBlockStatus('cli-e2e-app', 'web');
      assert.equal(statusAfterStop.state, 'stopped');
    } finally {
      await stopDaemonForTest(server, composition);
      if (capturedPid) {
        try {
          process.kill(-capturedPid, 'SIGKILL');
        } catch {}
        try {
          process.kill(capturedPid, 'SIGKILL');
        } catch {}
      }
    }
  });
});
