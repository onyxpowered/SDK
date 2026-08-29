// SDK
// Designed & Built By onyxpowered.

import { readdir, mkdir, readFile, writeFile, readlink, symlink, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHIP_HEADER_LINE = '// Ship';
const SDK_HEADER_LINE = '// SDK';

// Directories never worth syncing byte-for-byte: an installed dependency tree
// is platform-specific (native binaries) and re-decoding it as utf8 below
// would corrupt it -- sdk installs its own via the package.json that DOES
// sync, rather than receiving ship's literal node_modules.
const SKIPPED_DIR_NAMES = new Set(['node_modules']);

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultShipPlatformDir = join(scriptDir, '..', '..', 'Ship', 'Platform');
const defaultSdkPlatformDir = join(scriptDir, '..', 'Platform');

// a symlink (e.g. Platform/Sym.js) must stay a symlink on the sdk side, not get
// silently flattened into a duplicated regular file by following it and
// copying its target's content -- that would misrepresent ship's actual
// structure and leave two copies of the same source to drift apart.
async function collectEntries(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  let files = [];
  for (const entry of entries) {
    if (SKIPPED_DIR_NAMES.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      files.push({ path: full, isSymlink: true });
    } else if (entry.isDirectory()) {
      files = files.concat(await collectEntries(full));
    } else {
      files.push({ path: full, isSymlink: false });
    }
  }
  return files;
}

// CLI-invocation renames: ship's own casing convention keeps "Ship" (the
// brand) capitalized everywhere and reserves lowercase "ship" strictly for
// the literal command a user types -- so every lowercase "ship" token in
// these user-facing strings is safe to retarget at sdk's own bin name, and
// nothing else needs touching. Exact substrings, not a blanket find/replace,
// so this can never clip "shipHome", "Ship", or similar incidental matches.
const CLI_RENAME_REPLACEMENTS = {
  'Works/Systemworks/Subworks/CLI.js': [
    ['usage: ship stop <app> or ship stop <app>:<block>', 'usage: sdk stop <app> or sdk stop <app>:<block>'],
    ['ship-vault-backup-${Date.now()}.json', 'sdk-vault-backup-${Date.now()}.json'],
    ['usage: ship vault import <bundlePath>', 'usage: sdk vault import <bundlePath>'],
    ['usage: ship new <appName>', 'usage: sdk new <appName>'],
    ['`ship new` from inside a repo', '`sdk new` from inside a repo'],
    ['usage: ship connector install <name>', 'usage: sdk connector install <name>'],
    ['usage: ship connector uninstall <name>', 'usage: sdk connector uninstall <name>'],
    [
      'usage: ship connector publish <name> <version> <sourceDir> [--token=TOKEN]',
      'usage: sdk connector publish <name> <version> <sourceDir> [--token=TOKEN]',
    ],
    ['via `ship daemon install`', 'via `sdk daemon install`'],
  ],
  'Works/Systemworks/Subworks/Import.js': [
    ['ship import requires a source', 'sdk import requires a source'],
    ['ship import --from requires a source repo', 'sdk import --from requires a source repo'],
  ],
  'Works/Systemworks/Subworks/Scaffold.js': [['ship new requires an app name', 'sdk new requires an app name']],
  'Works/Interworks/Subworks/Auth.js': [['run `ship login` first', 'run `sdk login` first']],
  'Works/Vendworks/Subworks/Publisher.js': [
    ['requires an auth token from `ship login`', 'requires an auth token from `sdk login`'],
  ],
  'Works/Systemworks/Subworks/ServiceRegistration.js': [
    ["'com.onyxpowered.ship.daemon'", "'com.onyxpowered.sdk.daemon'"],
    ["'ShipDaemon'", "'SdkDaemon'"],
    ["'ship-daemon.service'", "'sdk-daemon.service'"],
  ],
};

// the header identifies which repo a file ships in, not where the text was
// originally authored -- so a file physically landing inside sdk's tree
// gets sdk's own header line, even though the rest of the file (including
// the "designed & built by onyxlabs" line) is copied byte-for-byte. The
// header is normally line 0, but CLI.js's #!/usr/bin/env node shebang (the
// one file ever installed as a package.json bin target) pushes it to line 1.
// Beyond the header, a small fixed set of files also get their literal
// `ship` CLI-invocation text retargeted at sdk's own bin name -- see
// CLI_RENAME_REPLACEMENTS above for why this is safe as an exact-substring
// swap rather than a broader rename.
function rewriteContentsForSdk(relativePath, contents) {
  const lines = contents.split('\n');
  const headerIndex = lines[0].startsWith('#!') ? 1 : 0;
  if (lines[headerIndex] === SHIP_HEADER_LINE) {
    lines[headerIndex] = SDK_HEADER_LINE;
  }
  let rewritten = lines.join('\n');

  const replacements = CLI_RENAME_REPLACEMENTS[relativePath];
  if (replacements) {
    for (const [from, to] of replacements) {
      rewritten = rewritten.split(from).join(to);
    }
  }

  return rewritten;
}

// copies every real (non-test) source file from ship's Platform/ tree into
// sdk's Platform/ tree, overwriting sdk's copy so the two stay in lockstep.
// sdk's own *.test.js files are never enumerated, touched, or deleted here --
// this function only ever walks and reads from the ship side.
export async function syncFromShip(options = {}) {
  const shipPlatformDir = options.shipPlatformDir ?? defaultShipPlatformDir;
  const sdkPlatformDir = options.sdkPlatformDir ?? defaultSdkPlatformDir;

  if (!existsSync(shipPlatformDir)) {
    throw new Error(`ship Platform directory not found at ${shipPlatformDir}`);
  }

  const entries = await collectEntries(shipPlatformDir);
  const copied = [];
  const symlinked = [];
  const skipped = [];

  for (const entry of entries) {
    const file = entry.path;
    if (file.endsWith('.test.js')) {
      skipped.push(relative(shipPlatformDir, file));
      continue;
    }
    const relativePath = relative(shipPlatformDir, file);
    const destPath = join(sdkPlatformDir, relativePath);
    await mkdir(dirname(destPath), { recursive: true });

    if (entry.isSymlink) {
      const target = await readlink(file);
      await rm(destPath, { force: true });
      await symlink(target, destPath);
      symlinked.push(relativePath);
      continue;
    }

    const contents = await readFile(file, 'utf8');
    await writeFile(destPath, rewriteContentsForSdk(relativePath, contents));
    copied.push(relativePath);
  }

  return { copied, symlinked, skipped, shipPlatformDir, sdkPlatformDir };
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  syncFromShip().then(
    (result) => {
      console.log(`synced ${result.copied.length} file(s): ${result.shipPlatformDir} -> ${result.sdkPlatformDir}`);
      for (const file of result.copied.sort()) {
        console.log(`  ${file}`);
      }
      if (result.symlinked.length > 0) {
        console.log(`relinked ${result.symlinked.length} symlink(s):`);
        for (const file of result.symlinked.sort()) {
          console.log(`  ${file}`);
        }
      }
      if (result.skipped.length > 0) {
        console.log(`skipped ${result.skipped.length} ship test file(s) -- tests never sync`);
      }
    },
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}
