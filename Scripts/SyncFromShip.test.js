// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile, symlink, readlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncFromShip } from './SyncFromShip.js';

async function withTempDirs(run) {
  const shipPlatformDir = await mkdtemp(join(tmpdir(), 'sync-ship-'));
  const sdkPlatformDir = await mkdtemp(join(tmpdir(), 'sync-sdk-'));
  try {
    await run({ shipPlatformDir, sdkPlatformDir });
  } finally {
    await rm(shipPlatformDir, { recursive: true, force: true });
    await rm(sdkPlatformDir, { recursive: true, force: true });
  }
}

test('syncFromShip rewrites a plain "// Ship" header to "// SDK" on line 0', async () => {
  await withTempDirs(async ({ shipPlatformDir, sdkPlatformDir }) => {
    await writeFile(join(shipPlatformDir, 'Example.js'), '// Ship\n// Designed & Built By onyxpowered.\n\nexport const x = 1;\n');
    const result = await syncFromShip({ shipPlatformDir, sdkPlatformDir });
    assert.deepEqual(result.copied, ['Example.js']);
    const contents = await readFile(join(sdkPlatformDir, 'Example.js'), 'utf8');
    assert.match(contents, /^\/\/ SDK\n/);
  });
});

test('syncFromShip rewrites the header on line 1 when a shebang occupies line 0', async () => {
  await withTempDirs(async ({ shipPlatformDir, sdkPlatformDir }) => {
    await writeFile(
      join(shipPlatformDir, 'CLI.js'),
      '#!/usr/bin/env node\n// Ship\n// Designed & Built By onyxpowered.\n\nconsole.log("hi");\n',
    );
    await syncFromShip({ shipPlatformDir, sdkPlatformDir });
    const lines = (await readFile(join(sdkPlatformDir, 'CLI.js'), 'utf8')).split('\n');
    assert.equal(lines[0], '#!/usr/bin/env node');
    assert.equal(lines[1], '// SDK');
    assert.equal(lines[2], '// Designed & Built By onyxpowered.');
  });
});

test('syncFromShip skips every *.test.js file without copying or deleting anything in sdk', async () => {
  await withTempDirs(async ({ shipPlatformDir, sdkPlatformDir }) => {
    await writeFile(join(shipPlatformDir, 'Real.js'), '// Ship\n// Designed & Built By onyxpowered.\n');
    await writeFile(join(shipPlatformDir, 'Real.test.js'), '// Ship\n// this should never exist in Ship anyway\n');
    const result = await syncFromShip({ shipPlatformDir, sdkPlatformDir });
    assert.deepEqual(result.skipped, ['Real.test.js']);
    assert.deepEqual(result.copied, ['Real.js']);
  });
});

test('syncFromShip relinks a symlink instead of copying its target contents', async () => {
  await withTempDirs(async ({ shipPlatformDir, sdkPlatformDir }) => {
    await writeFile(join(shipPlatformDir, 'Target.js'), '// Ship\n// Designed & Built By onyxpowered.\n');
    await symlink('./Target.js', join(shipPlatformDir, 'Sym.js'));
    const result = await syncFromShip({ shipPlatformDir, sdkPlatformDir });
    assert.deepEqual(result.symlinked, ['Sym.js']);
    const linkTarget = await readlink(join(sdkPlatformDir, 'Sym.js'));
    assert.equal(linkTarget, './Target.js');
  });
});

test('syncFromShip creates nested destination directories as needed', async () => {
  await withTempDirs(async ({ shipPlatformDir, sdkPlatformDir }) => {
    await mkdir(join(shipPlatformDir, 'Works', 'Deep', 'Nested'), { recursive: true });
    await writeFile(join(shipPlatformDir, 'Works', 'Deep', 'Nested', 'File.js'), '// Ship\n// Designed & Built By onyxpowered.\n');
    await syncFromShip({ shipPlatformDir, sdkPlatformDir });
    const contents = await readFile(join(sdkPlatformDir, 'Works', 'Deep', 'Nested', 'File.js'), 'utf8');
    assert.match(contents, /^\/\/ SDK\n/);
  });
});

test('syncFromShip throws a clear error when the ship Platform directory does not exist', async () => {
  await withTempDirs(async ({ sdkPlatformDir }) => {
    await assert.rejects(
      () => syncFromShip({ shipPlatformDir: join(sdkPlatformDir, 'does-not-exist'), sdkPlatformDir }),
      /not found/,
    );
  });
});

test('syncFromShip never descends into node_modules -- an installed dependency is platform-specific and would be corrupted by a utf8 round-trip', async () => {
  await withTempDirs(async ({ shipPlatformDir, sdkPlatformDir }) => {
    await mkdir(join(shipPlatformDir, 'Works', 'Systemworks', 'Subworks', 'node_modules', 'sharp'), { recursive: true });
    await writeFile(
      join(shipPlatformDir, 'Works', 'Systemworks', 'Subworks', 'node_modules', 'sharp', 'binding.node'),
      Buffer.from([0x00, 0xff, 0xfe, 0x01]),
    );
    await writeFile(
      join(shipPlatformDir, 'Works', 'Systemworks', 'Subworks', 'package.json'),
      '{\n  "name": "ship-systemworks-subworks"\n}\n',
    );
    const result = await syncFromShip({ shipPlatformDir, sdkPlatformDir });
    assert.deepEqual(result.copied, ['Works/Systemworks/Subworks/package.json']);
    const destExists = existsSync(join(sdkPlatformDir, 'Works', 'Systemworks', 'Subworks', 'node_modules'));
    assert.equal(destExists, false);
  });
});

test('syncFromShip retargets CLI.js\'s ship-invocation usage strings at sdk\'s own bin name', async () => {
  await withTempDirs(async ({ shipPlatformDir, sdkPlatformDir }) => {
    await mkdir(join(shipPlatformDir, 'Works', 'Systemworks', 'Subworks'), { recursive: true });
    await writeFile(
      join(shipPlatformDir, 'Works', 'Systemworks', 'Subworks', 'CLI.js'),
      "#!/usr/bin/env node\n// Ship\n// Designed & Built By onyxpowered.\n\nthrow new Error('usage: ship new <appName>');\n",
    );
    await syncFromShip({ shipPlatformDir, sdkPlatformDir });
    const contents = await readFile(join(sdkPlatformDir, 'Works', 'Systemworks', 'Subworks', 'CLI.js'), 'utf8');
    assert.match(contents, /usage: sdk new <appName>/);
    assert.doesNotMatch(contents, /usage: ship new/);
  });
});

test('syncFromShip retargets ServiceRegistration.js\'s service identifiers so sdk never collides with a real ship install', async () => {
  await withTempDirs(async ({ shipPlatformDir, sdkPlatformDir }) => {
    await mkdir(join(shipPlatformDir, 'Works', 'Systemworks', 'Subworks'), { recursive: true });
    await writeFile(
      join(shipPlatformDir, 'Works', 'Systemworks', 'Subworks', 'ServiceRegistration.js'),
      "// Ship\n// Designed & Built By onyxpowered.\n\nconst SERVICE_LABEL = 'com.onyxpowered.ship.daemon';\nconst WINDOWS_SERVICE_NAME = 'ShipDaemon';\n",
    );
    await syncFromShip({ shipPlatformDir, sdkPlatformDir });
    const contents = await readFile(join(sdkPlatformDir, 'Works', 'Systemworks', 'Subworks', 'ServiceRegistration.js'), 'utf8');
    assert.match(contents, /'com\.onyxpowered\.sdk\.daemon'/);
    assert.match(contents, /'SdkDaemon'/);
  });
});

test('syncFromShip leaves unrelated files\' incidental "ship" substrings (e.g. shipHome) untouched', async () => {
  await withTempDirs(async ({ shipPlatformDir, sdkPlatformDir }) => {
    await writeFile(
      join(shipPlatformDir, 'Paths.js'),
      "// Ship\n// Designed & Built By onyxpowered.\n\nexport function resolveShipHome() { return 'x'; }\n",
    );
    await syncFromShip({ shipPlatformDir, sdkPlatformDir });
    const contents = await readFile(join(sdkPlatformDir, 'Paths.js'), 'utf8');
    assert.match(contents, /resolveShipHome/);
  });
});
