// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { socketPath, blockworksDir } from './Paths.js';

function withPlatform(platformName, run) {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platformName, configurable: true });
  try {
    return run();
  } finally {
    Object.defineProperty(process, 'platform', original);
  }
}

test('Paths: a very long shipHome path falls back to a short tmpdir-hashed Unix socket path', () => {
  withPlatform('darwin', () => {
    const longShipHome = `/tmp/${'x'.repeat(200)}/.ship`;
    const path = socketPath(longShipHome);
    assert.ok(path.length < 108, `socket path too long for sun_path: ${path.length}`);
    assert.match(path, /ship-[0-9a-f]{16}\.sock$/);
  });
});

test('Paths: a short shipHome path keeps the direct, human-readable Unix socket path', () => {
  withPlatform('darwin', () => {
    const path = socketPath('/tmp/short-ship-home');
    assert.equal(path, '/tmp/short-ship-home/daemon.sock');
  });
});

test('Paths: Windows named pipe names are derived from shipHome, so two different shipHomes never collide', () => {
  withPlatform('win32', () => {
    const pipeA = socketPath('C:\\Users\\alice\\.ship');
    const pipeB = socketPath('C:\\Users\\bob\\.ship');
    assert.notEqual(pipeA, pipeB);
    assert.match(pipeA, /^\\\\\.\\pipe\\ship-daemon-[0-9a-f]{16}$/);
    assert.match(pipeB, /^\\\\\.\\pipe\\ship-daemon-[0-9a-f]{16}$/);
  });
});

test('Paths: the same shipHome always derives the same Windows pipe name', () => {
  withPlatform('win32', () => {
    const first = socketPath('C:\\Users\\alice\\.ship');
    const second = socketPath('C:\\Users\\alice\\.ship');
    assert.equal(first, second);
  });
});

test('Paths: blockworksDir nests under shipHome, alongside vault and logs', () => {
  assert.equal(blockworksDir('/tmp/some-ship-home'), '/tmp/some-ship-home/blockworks');
});
