// SDK
// Designed & Built By onyxpowered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installCaTrust, uninstallCaTrust, manualTrustInstructions } from './Trust.js';

function fakeRun(calls, response = { code: 0, stdout: '', stderr: '' }) {
  return async (command, args) => {
    calls.push([command, args]);
    return response;
  };
}

test('installCaTrust on darwin calls security add-trusted-cert against the System keychain', async () => {
  const calls = [];
  const { platform, result } = await installCaTrust({
    certPath: '/tmp/ca.pem',
    platform: 'darwin',
    run: fakeRun(calls),
  });
  assert.equal(platform, 'darwin');
  assert.equal(result.code, 0);
  assert.equal(calls.length, 1);
  const [command, args] = calls[0];
  assert.equal(command, 'security');
  assert.deepEqual(args, ['add-trusted-cert', '-d', '-r', 'trustRoot', '-k', '/Library/Keychains/System.keychain', '/tmp/ca.pem']);
});

test('uninstallCaTrust on darwin calls security remove-trusted-cert', async () => {
  const calls = [];
  await uninstallCaTrust({ certPath: '/tmp/ca.pem', platform: 'darwin', run: fakeRun(calls) });
  assert.deepEqual(calls[0], ['security', ['remove-trusted-cert', '-d', '/tmp/ca.pem']]);
});

test('installCaTrust on win32 calls certutil -addstore against the ROOT store', async () => {
  const calls = [];
  const { result } = await installCaTrust({ certPath: 'C:\\ca.pem', platform: 'win32', run: fakeRun(calls) });
  assert.equal(result.code, 0);
  assert.deepEqual(calls[0], ['certutil', ['-addstore', '-f', 'ROOT', 'C:\\ca.pem']]);
});

test('uninstallCaTrust on win32 calls certutil -delstore ROOT with the CA name', async () => {
  const calls = [];
  await uninstallCaTrust({ platform: 'win32', name: 'My Ship CA', run: fakeRun(calls) });
  assert.deepEqual(calls[0], ['certutil', ['-delstore', 'ROOT', 'My Ship CA']]);
});

test('installCaTrust on linux copies the cert into the system CA dir and runs update-ca-certificates', async () => {
  const calls = [];
  const copied = [];
  const dirsEnsured = [];
  const { result } = await installCaTrust({
    certPath: '/tmp/ca.pem',
    name: 'Ship Local Development CA',
    platform: 'linux',
    run: fakeRun(calls),
    copyFile: async (src, dest) => copied.push([src, dest]),
    ensureDir: async (dir) => dirsEnsured.push(dir),
  });

  assert.equal(dirsEnsured[0], '/usr/local/share/ca-certificates');
  assert.equal(copied[0][0], '/tmp/ca.pem');
  assert.equal(copied[0][1], '/usr/local/share/ca-certificates/ship-ship-local-development-ca.crt');
  assert.equal(result.destPath, '/usr/local/share/ca-certificates/ship-ship-local-development-ca.crt');

  const commands = calls.map(([command]) => command);
  assert.ok(commands.includes('update-ca-certificates'));
  assert.ok(commands.includes('certutil'));
});

test('installCaTrust on linux treats a failing NSS certutil call as optional, not fatal', async () => {
  const calls = [];
  const run = async (command, args) => {
    calls.push([command, args]);
    if (command === 'certutil') {
      return { code: 1, stdout: '', stderr: 'no nssdb found' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };

  const { result } = await installCaTrust({
    certPath: '/tmp/ca.pem',
    platform: 'linux',
    run,
    copyFile: async () => {},
    ensureDir: async () => {},
  });

  assert.equal(result.updateResult.code, 0);
  assert.equal(result.nssResult.code, 1);
  assert.equal(result.nssResult.optional, true);
});

test('uninstallCaTrust on linux removes the file and refreshes the CA store', async () => {
  const calls = [];
  const unlinked = [];
  await uninstallCaTrust({
    name: 'Ship Local Development CA',
    platform: 'linux',
    run: fakeRun(calls),
    unlink: async (path) => unlinked.push(path),
  });
  assert.equal(unlinked[0], '/usr/local/share/ca-certificates/ship-ship-local-development-ca.crt');
  assert.deepEqual(calls[0], ['update-ca-certificates', ['--fresh']]);
});

test('installCaTrust/uninstallCaTrust reject an unsupported platform rather than silently no-op', async () => {
  await assert.rejects(() => installCaTrust({ certPath: '/tmp/ca.pem', platform: 'freebsd' }), /unsupported platform/);
  await assert.rejects(() => uninstallCaTrust({ certPath: '/tmp/ca.pem', platform: 'freebsd' }), /unsupported platform/);
});

test('manualTrustInstructions returns platform-specific guidance for all three platforms plus a generic fallback', () => {
  assert.match(manualTrustInstructions('darwin', '/tmp/ca.pem'), /Keychain Access/);
  assert.match(manualTrustInstructions('win32', 'C:\\ca.pem'), /Trusted Root Certification Authorities/);
  assert.match(manualTrustInstructions('linux', '/tmp/ca.pem'), /update-ca-certificates/);
  assert.match(manualTrustInstructions('freebsd', '/tmp/ca.pem'), /Manually trust/);
});
