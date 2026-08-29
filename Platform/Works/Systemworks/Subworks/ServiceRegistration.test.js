// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installService, uninstallService } from './ServiceRegistration.js';

async function withTempHome(run) {
  const dir = await mkdtemp(join(tmpdir(), 'ship-service-registration-test-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function enoentExec() {
  return async () => {
    const error = new Error('spawn launchctl ENOENT');
    error.code = 'ENOENT';
    throw error;
  };
}

function nonZeroExitExec(message = 'Command failed with exit code 1: launchctl load') {
  return async () => {
    throw new Error(message);
  };
}

test('ServiceRegistration: install surfaces an ENOENT from exec clearly, not silently', async () => {
  await withTempHome(async (homeDir) => {
    await assert.rejects(
      () =>
        installService({
          scriptPath: '/fake/Platform.js',
          logPath: '/fake/daemon.log',
          platformName: 'darwin',
          homeDir,
          exec: enoentExec(),
        }),
      /ENOENT/,
    );
  });
});

test('ServiceRegistration: install surfaces a non-zero exit from exec, not silently swallowed', async () => {
  await withTempHome(async (homeDir) => {
    await assert.rejects(
      () =>
        installService({
          scriptPath: '/fake/Platform.js',
          logPath: '/fake/daemon.log',
          platformName: 'darwin',
          homeDir,
          exec: nonZeroExitExec(),
        }),
      /Command failed with exit code 1/,
    );
  });
});

test('ServiceRegistration: uninstallMac still removes the plist even when the unload call fails (permission error not hidden)', async () => {
  await withTempHome(async (homeDir) => {
    const plistDir = join(homeDir, 'Library', 'LaunchAgents');
    const plistPath = join(plistDir, 'com.onyxpowered.sdk.daemon.plist');
    await mkdir(plistDir, { recursive: true });
    await writeFile(plistPath, '<plist></plist>');
    assert.ok(existsSync(plistPath));

    const result = await uninstallService({
      platformName: 'darwin',
      homeDir,
      exec: nonZeroExitExec('launchctl: Operation not permitted'),
    });

    assert.equal(result.mechanism, 'launchd');
    assert.equal(existsSync(plistPath), false);
  });
});

test('ServiceRegistration: install throws a clear error on an unrecognized platform', async () => {
  await withTempHome(async (homeDir) => {
    await assert.rejects(
      () =>
        installService({
          scriptPath: '/fake/Platform.js',
          logPath: '/fake/daemon.log',
          platformName: 'plan9',
          homeDir,
          exec: async () => {},
        }),
      /unsupported platform for service registration: plan9/,
    );
  });
});

test('ServiceRegistration: uninstall throws a clear error on an unrecognized platform', async () => {
  await withTempHome(async (homeDir) => {
    await assert.rejects(
      () =>
        uninstallService({
          platformName: 'plan9',
          homeDir,
          exec: async () => {},
        }),
      /unsupported platform for service registration: plan9/,
    );
  });
});

test('ServiceRegistration: darwin install happy path writes the plist and invokes launchctl load', async () => {
  await withTempHome(async (homeDir) => {
    const calls = [];
    const exec = async (cmd, args) => {
      calls.push([cmd, args]);
      return { stdout: '', stderr: '' };
    };
    const result = await installService({
      nodePath: '/usr/bin/node',
      scriptPath: '/fake/Platform.js',
      logPath: join(homeDir, 'daemon.log'),
      platformName: 'darwin',
      homeDir,
      exec,
    });
    assert.equal(result.mechanism, 'launchd');
    assert.ok(existsSync(result.path));
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'launchctl');
    assert.deepEqual(calls[0][1], ['load', '-w', result.path]);
  });
});

test('ServiceRegistration: linux install happy path writes the unit and invokes systemctl twice', async () => {
  await withTempHome(async (homeDir) => {
    const calls = [];
    const exec = async (cmd, args) => {
      calls.push([cmd, args]);
      return { stdout: '', stderr: '' };
    };
    const result = await installService({
      nodePath: '/usr/bin/node',
      scriptPath: '/fake/Platform.js',
      logPath: join(homeDir, 'daemon.log'),
      platformName: 'linux',
      homeDir,
      exec,
    });
    assert.equal(result.mechanism, 'systemd');
    assert.ok(existsSync(result.path));
    assert.equal(calls.length, 2);
    assert.equal(calls[0][0], 'systemctl');
    assert.equal(calls[1][0], 'systemctl');
  });
});

test('ServiceRegistration: windows install happy path invokes sc.exe create with the expected service name', async () => {
  const calls = [];
  const exec = async (cmd, args) => {
    calls.push([cmd, args]);
    return { stdout: '', stderr: '' };
  };
  const result = await installService({
    nodePath: 'C:\\node.exe',
    scriptPath: 'C:\\fake\\Platform.js',
    logPath: 'C:\\fake\\daemon.log',
    platformName: 'win32',
    shipHome: null,
    path: null,
    exec,
  });
  assert.equal(result.mechanism, 'windows-service');
  assert.equal(calls.length, 1, 'no env vars means no reg add call, just sc.exe create');
  assert.equal(calls[0][0], 'sc.exe');
  assert.equal(calls[0][1][0], 'create');
});

test('ServiceRegistration: install carries the running process\'s PATH into the installed service on every platform', async () => {
  // launchd/systemd/SCM all give an installed service their own minimal
  // default PATH, not the interactive shell's -- without this, any Block
  // command relying on something installed via nvm/homebrew/etc (npm, yarn,
  // pnpm...) fails to spawn under the daemon even though it works run by
  // hand. This is exactly what happened in real use: `npm start` failing
  // with "npm: command not found" only under the installed daemon.
  const fakePath = '/Users/test/.nvm/versions/node/v22.0.0/bin:/usr/bin:/bin';

  await withTempHome(async (homeDir) => {
    const darwinResult = await installService({
      nodePath: '/usr/bin/node',
      scriptPath: '/fake/Platform.js',
      logPath: join(homeDir, 'daemon.log'),
      platformName: 'darwin',
      homeDir,
      path: fakePath,
      exec: async () => ({ stdout: '', stderr: '' }),
    });
    const plistContents = await readFile(darwinResult.path, 'utf8');
    assert.match(plistContents, /<key>PATH<\/key>\s*<string>[^<]*\.nvm[^<]*<\/string>/);
  });

  await withTempHome(async (homeDir) => {
    const linuxResult = await installService({
      nodePath: '/usr/bin/node',
      scriptPath: '/fake/Platform.js',
      logPath: join(homeDir, 'daemon.log'),
      platformName: 'linux',
      homeDir,
      path: fakePath,
      exec: async () => ({ stdout: '', stderr: '' }),
    });
    const unitContents = await readFile(linuxResult.path, 'utf8');
    assert.match(unitContents, new RegExp(`Environment=PATH=${fakePath.replace(/\//g, '\\/')}`));
  });

  const windowsCalls = [];
  await installService({
    nodePath: 'C:\\node.exe',
    scriptPath: 'C:\\fake\\Platform.js',
    logPath: 'C:\\fake\\daemon.log',
    platformName: 'win32',
    path: fakePath,
    exec: async (cmd, args) => {
      windowsCalls.push([cmd, args]);
      return { stdout: '', stderr: '' };
    },
  });
  const regCall = windowsCalls.find(([cmd]) => cmd === 'reg');
  assert.ok(regCall, 'expected a reg add call to register PATH');
  const regValue = regCall[1][regCall[1].indexOf('/d') + 1];
  assert.ok(regValue.split('\0').includes(`PATH=${fakePath}`));
});
