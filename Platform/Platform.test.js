// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boot } from './Platform.js';

async function withTempShipHome(run) {
  const dir = await mkdtemp(join(tmpdir(), 'ship-platform-test-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('Platform: fails loud when a Work is missing on disk', async () => {
  await withTempShipHome(async (shipHome) => {
    const works = [{ name: 'GhostWork', modulePath: './__fixtures__/DoesNotExist.js' }];
    await assert.rejects(() => boot({ shipHome, works }), /GhostWork is missing on disk/);
  });
});

test('Platform: fails loud with an exact-match message on a version mismatch', async () => {
  await withTempShipHome(async (shipHome) => {
    const works = [{ name: 'GoodWork', modulePath: './__fixtures__/GoodWork.js' }];
    await assert.rejects(
      () => boot({ shipHome, works, requiredVersions: { GoodWork: '2.0.0' } }),
      /GoodWork 2\.0\.0 expected, found 1\.0\.0/,
    );
  });
});

test('Platform: fails loud when a required Work has no VERSION export at all', async () => {
  await withTempShipHome(async (shipHome) => {
    const works = [{ name: 'UnversionedWork', modulePath: './__fixtures__/UnversionedWork.js' }];
    await assert.rejects(
      () => boot({ shipHome, works, requiredVersions: { UnversionedWork: '1.0.0' } }),
      /UnversionedWork 1\.0\.0 expected, found none/,
    );
  });
});

test('Platform: exact version match passes the check', async () => {
  await withTempShipHome(async (shipHome) => {
    const works = [{ name: 'GoodWork', modulePath: './__fixtures__/GoodWork.js' }];
    const result = await boot({ shipHome, works, requiredVersions: { GoodWork: '1.0.0' } });
    assert.ok(result.vault);
    result.readyReport.server.close();
  });
});

test('Platform: Systemworks is explicitly exempt from its own version check -- a deliberately wrong required version for "Systemworks" does not block boot', async () => {
  await withTempShipHome(async (shipHome) => {
    const works = [
      { name: 'Vault', modulePath: '../Vault/Vault.js' },
      { name: 'Systemworks', modulePath: './Systemworks/Systemworks.js' },
    ];
    const result = await boot({
      shipHome,
      works,
      requiredVersions: { Vault: '0.1.0', Systemworks: '99.99.99' },
    });
    try {
      assert.ok(result.vault);
      assert.ok(result.readyReport.server.listening);
    } finally {
      result.readyReport.server.close();
    }
  });
});

test('Platform: full boot sequence -- Platform -> Vault -> Systemworks -- actually boots the daemon', async () => {
  await withTempShipHome(async (shipHome) => {
    const works = [
      { name: 'Vault', modulePath: '../Vault/Vault.js' },
      { name: 'Systemworks', modulePath: './Systemworks/Systemworks.js' },
    ];
    const result = await boot({ shipHome, works, requiredVersions: { Vault: '0.1.0' } });
    try {
      assert.ok(result.vault);
      assert.ok(result.readyReport.server.listening);
      const pid = await result.vault.interface.readReserved('daemon/pid');
      assert.equal(pid, process.pid);
    } finally {
      result.readyReport.server.close();
    }
  });
});
