// SDK
// Designed & Built By onyxpowered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importSource, isGitSource, resolveGitUrl, isArchiveSource } from './Import.js';

const execFileAsync = promisify(execFile);

async function tempDir(prefix) {
  return mkdtemp(join(tmpdir(), prefix));
}

async function makeLocalGitRepo({ withPackageJson = true, monorepo = false } = {}) {
  const dir = await tempDir('ship-import-gitsrc-');
  if (monorepo) {
    await mkdir(join(dir, 'apps', 'web'), { recursive: true });
    await writeFile(join(dir, 'apps', 'web', 'package.json'), JSON.stringify({ scripts: { start: 'node index.js' } }));
    await writeFile(join(dir, 'README.md'), '# monorepo\n');
  } else if (withPackageJson) {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { start: 'node index.js' } }));
    await writeFile(join(dir, 'index.js'), 'console.log("hi");\n');
  } else {
    await writeFile(join(dir, 'README.md'), '# no framework here\n');
  }
  await execFileAsync('git', ['init', '-q', dir]);
  await execFileAsync('git', ['-C', dir, 'add', '-A']);
  await execFileAsync('git', ['-C', dir, 'commit', '-q', '-m', 'fixture'], {
    env: { ...process.env, GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@example.com', GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@example.com' },
  });
  return dir;
}

// --- source-type recognition -------------------------------------------------

test('isGitSource: recognizes gh: shorthand, full https URLs, and bare host URLs', () => {
  assert.equal(isGitSource('gh:onyxpowered/Ship'), true);
  assert.equal(isGitSource('https://github.com/onyxpowered/Ship.git'), true);
  assert.equal(isGitSource('https://gitlab.com/someone/project'), true);
  assert.equal(isGitSource('/Users/me/my-app'), false);
  assert.equal(isGitSource('./relative/path'), false);
});

test('resolveGitUrl: expands gh:/gl:/bb: shorthand to the real clone URL', () => {
  assert.equal(resolveGitUrl('gh:onyxpowered/Ship'), 'https://github.com/onyxpowered/Ship.git');
  assert.equal(resolveGitUrl('gl:someone/project'), 'https://gitlab.com/someone/project.git');
  assert.equal(resolveGitUrl('https://github.com/onyxpowered/Ship.git'), 'https://github.com/onyxpowered/Ship.git');
});

test('isArchiveSource: recognizes .zip and .tar.gz, rejects everything else', () => {
  assert.equal(isArchiveSource('app.zip'), true);
  assert.equal(isArchiveSource('app.tar.gz'), true);
  assert.equal(isArchiveSource('app.tgz'), true);
  assert.equal(isArchiveSource('gh:someone/repo'), false);
  assert.equal(isArchiveSource('/local/path'), false);
});

// --- local filesystem path ----------------------------------------------------

test('importSource: local path with an existing package.json auto-detects and writes ship.config.js', async () => {
  const source = await tempDir('ship-import-local-');
  await writeFile(join(source, 'package.json'), JSON.stringify({ scripts: { start: 'node index.js' } }));
  const appsDir = await tempDir('ship-import-apps-');
  const result = await importSource(source, { appsDir });
  assert.ok(existsSync(join(result.appRootDir, 'ship.config.js')));
  assert.match(result.detected, /auto-detected/);
  const config = (await import(`${result.appRootDir}/ship.config.js`)).default;
  assert.equal(config.blocks.web.command, 'npm start');
  assert.equal(config.blocks.web.expose, true);
});

test('importSource: local path with an existing ship.config.js is left untouched, not overwritten', async () => {
  const source = await tempDir('ship-import-local-');
  await writeFile(join(source, 'ship.config.js'), 'export default { blocks: { custom: { command: "echo hi", expose: true } } };\n');
  const appsDir = await tempDir('ship-import-apps-');
  const result = await importSource(source, { appsDir });
  const config = (await import(`${result.appRootDir}/ship.config.js`)).default;
  assert.equal(config.blocks.custom.command, 'echo hi');
  assert.equal(result.detected, 'existing ship.config.js used as-is');
});

test('importSource: local path import copies files, does not just reference the original directory', async () => {
  const source = await tempDir('ship-import-local-');
  await writeFile(join(source, 'package.json'), JSON.stringify({ scripts: { start: 'node index.js' } }));
  const appsDir = await tempDir('ship-import-apps-');
  const result = await importSource(source, { appsDir });
  assert.notEqual(result.appRootDir, source);
  await writeFile(join(source, 'marker.txt'), 'only in source');
  assert.equal(existsSync(join(result.appRootDir, 'marker.txt')), false);
});

// --- zip / tarball --------------------------------------------------------------

test('importSource: zip archive is extracted and auto-detected', async () => {
  const staging = await tempDir('ship-import-zipsrc-');
  await writeFile(join(staging, 'package.json'), JSON.stringify({ scripts: { start: 'node index.js' } }));
  const archiveDir = await tempDir('ship-import-archives-');
  const zipPath = join(archiveDir, 'app.zip');
  await execFileAsync('zip', ['-q', '-r', zipPath, '.'], { cwd: staging });
  const appsDir = await tempDir('ship-import-apps-');
  const result = await importSource(zipPath, { appsDir, appName: 'from-zip' });
  assert.ok(existsSync(join(result.appRootDir, 'package.json')));
  assert.match(result.detected, /auto-detected/);
});

test('importSource: tar.gz archive is extracted and auto-detected', async () => {
  const staging = await tempDir('ship-import-tgzsrc-');
  await writeFile(join(staging, 'package.json'), JSON.stringify({ scripts: { start: 'node index.js' } }));
  const archiveDir = await tempDir('ship-import-archives-');
  const tarPath = join(archiveDir, 'app.tar.gz');
  await execFileAsync('tar', ['-czf', tarPath, '-C', staging, '.']);
  const appsDir = await tempDir('ship-import-apps-');
  const result = await importSource(tarPath, { appsDir, appName: 'from-tar' });
  assert.ok(existsSync(join(result.appRootDir, 'package.json')));
});

test('importSource: an archive with one top-level wrapper directory gets flattened', async () => {
  const staging = await tempDir('ship-import-wrapped-');
  await mkdir(join(staging, 'my-project'));
  await writeFile(join(staging, 'my-project', 'package.json'), JSON.stringify({ scripts: { start: 'node index.js' } }));
  const archiveDir = await tempDir('ship-import-archives-');
  const zipPath = join(archiveDir, 'wrapped.zip');
  await execFileAsync('zip', ['-q', '-r', zipPath, 'my-project'], { cwd: staging });
  const appsDir = await tempDir('ship-import-apps-');
  const result = await importSource(zipPath, { appsDir, appName: 'from-wrapped-zip' });
  assert.ok(existsSync(join(result.appRootDir, 'package.json')), 'package.json should be at the flattened root, not nested under my-project/');
});

test('importSource: a nonexistent archive path fails loud with a clear error', async () => {
  const appsDir = await tempDir('ship-import-apps-');
  await assert.rejects(() => importSource('/tmp/does-not-exist-12345.zip', { appsDir }), /archive not found/);
});

// --- git repo, local fixture (fast, no network dependency) ----------------------

test('importSource: clones a local git repo and auto-detects', async () => {
  const repo = await makeLocalGitRepo({ withPackageJson: true });
  const appsDir = await tempDir('ship-import-apps-');
  const result = await importSource(repo, { appsDir, appName: 'from-local-git' });
  assert.ok(existsSync(join(result.appRootDir, '.git')));
  assert.ok(existsSync(join(result.appRootDir, 'ship.config.js')));
});

test('importSource: --path= selects a monorepo subdirectory as the App root', async () => {
  const repo = await makeLocalGitRepo({ monorepo: true });
  const appsDir = await tempDir('ship-import-apps-');
  const result = await importSource(repo, { appsDir, appName: 'monorepo-web', subPath: 'apps/web' });
  assert.ok(existsSync(join(result.appRootDir, 'package.json')));
  assert.equal(existsSync(join(result.appRootDir, 'README.md')), false, 'the subdirectory root should not see the monorepo-level README');
});

test('importSource: a --path= that does not exist in the source fails loud', async () => {
  const repo = await makeLocalGitRepo({ withPackageJson: true });
  const appsDir = await tempDir('ship-import-apps-');
  await assert.rejects(
    () => importSource(repo, { appsDir, appName: 'bad-path', subPath: 'does/not/exist' }),
    /does not exist/,
  );
});

test('importSource: a source with no detectable framework and no ship.config.js fails loud with a specific message', async () => {
  const repo = await makeLocalGitRepo({ withPackageJson: false });
  const appsDir = await tempDir('ship-import-apps-');
  await assert.rejects(() => importSource(repo, { appsDir, appName: 'undetectable' }), /could not detect a framework/);
});

// --- real network clone, proving the actual transport works, not just the git logic --

test('importSource: clones a real public repo over the network (github.com)', async () => {
  // octocat/Hello-World has no package.json/requirements.txt/index.html, so framework
  // detection correctly fails loud AFTER the clone succeeds -- that failure is itself
  // the proof the network clone worked (it got past cloning to the detection step),
  // and the cloned .git directory is left on disk to check directly either way.
  const appsDir = await tempDir('ship-import-apps-');
  await assert.rejects(
    () => importSource('https://github.com/octocat/Hello-World.git', { appsDir, appName: 'octocat-hello-world' }),
    /could not detect a framework/,
  );
  const clonedDir = join(appsDir, 'octocat-hello-world');
  assert.ok(existsSync(join(clonedDir, '.git')), 'the real network clone should have happened before detection ran');
  assert.ok(existsSync(join(clonedDir, 'README')) || existsSync(join(clonedDir, 'README.md')));
});

// --- --from= migration ------------------------------------------------------------

test('importSource: --from=heroku translates a Procfile into ship.config.js', async () => {
  const source = await tempDir('ship-import-heroku-');
  await writeFile(join(source, 'Procfile'), 'web: node server.js\n');
  const appsDir = await tempDir('ship-import-apps-');
  const result = await importSource(source, { appsDir, from: 'heroku', appName: 'from-heroku' });
  assert.match(result.detected, /heroku/);
  const config = (await import(`${result.appRootDir}/ship.config.js`)).default;
  assert.equal(config.blocks.web.command, 'node server.js');
});

test('importSource: --from=vercel translates vercel.json into ship.config.js', async () => {
  const source = await tempDir('ship-import-vercel-');
  await writeFile(join(source, 'vercel.json'), JSON.stringify({ buildCommand: 'npm run build', startCommand: 'npm run start:prod' }));
  const appsDir = await tempDir('ship-import-apps-');
  const result = await importSource(source, { appsDir, from: 'vercel', appName: 'from-vercel' });
  assert.match(result.detected, /vercel/);
  const config = (await import(`${result.appRootDir}/ship.config.js`)).default;
  assert.equal(config.blocks.web.command, 'npm run build && npm run start:prod');
});

test('importSource: --from=railway translates docker-compose.yml into ship.config.js', async () => {
  const source = await tempDir('ship-import-railway-');
  await writeFile(join(source, 'docker-compose.yml'), 'services:\n  web:\n    command: npm start\n');
  const appsDir = await tempDir('ship-import-apps-');
  const result = await importSource(source, { appsDir, from: 'railway', appName: 'from-railway' });
  assert.match(result.detected, /docker-compose/);
});

test('importSource: --from with no migratable config falls back to plain framework detection', async () => {
  const source = await tempDir('ship-import-noconfig-');
  await writeFile(join(source, 'package.json'), JSON.stringify({ scripts: { start: 'node index.js' } }));
  const appsDir = await tempDir('ship-import-apps-');
  const result = await importSource(source, { appsDir, from: 'vercel', appName: 'fallback-detect' });
  assert.match(result.detected, /auto-detected/);
});

// --- error paths ------------------------------------------------------------------

test('importSource: an unrecognized source string fails with a clear, specific error', async () => {
  const appsDir = await tempDir('ship-import-apps-');
  await assert.rejects(() => importSource('not-a-real-source-of-any-kind', { appsDir }), /could not determine how to import/);
});

test('importSource: no source and no --from throws a usage error', async () => {
  const appsDir = await tempDir('ship-import-apps-');
  await assert.rejects(() => importSource(undefined, { appsDir }), /requires a source/);
});
