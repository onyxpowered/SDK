// SDK
// Designed & Built By onyxpowered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  hashFile,
  listFilesRecursive,
  computeArtifactIntegrity,
  integrityManifestPath,
  saveArtifactIntegrity,
  loadArtifactIntegrity,
  deployArtifact,
  compareArtifactIntegrity,
  verifyArtifactIntegrity,
} from './Artifact.js';

async function makeBuildOutput() {
  const dir = await mkdtemp(join(tmpdir(), 'ship-artifact-test-'));
  await mkdir(join(dir, 'assets'), { recursive: true });
  await writeFile(join(dir, 'index.html'), '<html>hello</html>');
  await writeFile(join(dir, 'assets', 'app.js'), 'console.log("hi");');
  await writeFile(join(dir, 'assets', 'style.css'), 'body { color: red; }');
  return dir;
}

test('hashFile returns the sha256 hex digest of a file\'s contents', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ship-artifact-hashfile-'));
  try {
    const filePath = join(dir, 'a.txt');
    await writeFile(filePath, 'hello world');
    const expected = createHash('sha256').update('hello world').digest('hex');
    assert.equal(await hashFile(filePath), expected);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('listFilesRecursive returns every file as a forward-slash relative path, sorted', async () => {
  const dir = await makeBuildOutput();
  try {
    const files = await listFilesRecursive(dir);
    assert.deepEqual(files, ['assets/app.js', 'assets/style.css', 'index.html']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('computeArtifactIntegrity hashes every file and combines them into one manifest hash', async () => {
  const dir = await makeBuildOutput();
  try {
    const integrity = await computeArtifactIntegrity(dir);
    assert.equal(integrity.algorithm, 'sha256');
    assert.equal(integrity.fileCount, 3);
    assert.equal(Object.keys(integrity.files).length, 3);
    assert.equal(integrity.files['index.html'], createHash('sha256').update('<html>hello</html>').digest('hex'));
    assert.match(integrity.manifestHash, /^[0-9a-f]{64}$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('computeArtifactIntegrity is deterministic for identical content', async () => {
  const dirA = await makeBuildOutput();
  const dirB = await makeBuildOutput();
  try {
    const integrityA = await computeArtifactIntegrity(dirA);
    const integrityB = await computeArtifactIntegrity(dirB);
    assert.equal(integrityA.manifestHash, integrityB.manifestHash);
  } finally {
    await rm(dirA, { recursive: true, force: true });
    await rm(dirB, { recursive: true, force: true });
  }
});

test('computeArtifactIntegrity changes when any file content changes', async () => {
  const dir = await makeBuildOutput();
  try {
    const before = await computeArtifactIntegrity(dir);
    await appendFile(join(dir, 'assets', 'app.js'), '\nconsole.log("tampered");');
    const after = await computeArtifactIntegrity(dir);
    assert.notEqual(before.manifestHash, after.manifestHash);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('deployArtifact writes a sidecar manifest file next to (not inside) the build output dir', async () => {
  const dir = await makeBuildOutput();
  try {
    const integrity = await deployArtifact(dir);
    const manifestPath = integrityManifestPath(dir);
    assert.equal(manifestPath, `${dir}.ship-integrity.json`);

    const loaded = await loadArtifactIntegrity(manifestPath);
    assert.equal(loaded.manifestHash, integrity.manifestHash);

    const filesInBuildDir = await listFilesRecursive(dir);
    assert.equal(filesInBuildDir.length, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(integrityManifestPath(dir), { force: true });
  }
});

test('verifyArtifactIntegrity reports valid:true when the build output matches the deployed manifest', async () => {
  const dir = await makeBuildOutput();
  try {
    await deployArtifact(dir);
    const result = await verifyArtifactIntegrity(dir);
    assert.equal(result.valid, true);
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.unexpected, []);
    assert.deepEqual(result.changed, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(integrityManifestPath(dir), { force: true });
  }
});

test('verifyArtifactIntegrity catches tampering: changed, missing, and unexpected files', async () => {
  const dir = await makeBuildOutput();
  try {
    await deployArtifact(dir);

    await appendFile(join(dir, 'index.html'), '<script>evil()</script>');
    const changedResult = await verifyArtifactIntegrity(dir);
    assert.equal(changedResult.valid, false);
    assert.deepEqual(changedResult.changed, ['index.html']);

    await writeFile(join(dir, 'index.html'), '<html>hello</html>');
    await rm(join(dir, 'assets', 'style.css'));
    const missingResult = await verifyArtifactIntegrity(dir);
    assert.equal(missingResult.valid, false);
    assert.deepEqual(missingResult.missing, ['assets/style.css']);

    await writeFile(join(dir, 'assets', 'style.css'), 'body { color: red; }');
    await writeFile(join(dir, 'unexpected.txt'), 'surprise');
    const unexpectedResult = await verifyArtifactIntegrity(dir);
    assert.equal(unexpectedResult.valid, false);
    assert.deepEqual(unexpectedResult.unexpected, ['unexpected.txt']);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(integrityManifestPath(dir), { force: true });
  }
});

test('compareArtifactIntegrity is a pure function usable without touching the filesystem', async () => {
  const dir = await makeBuildOutput();
  try {
    const expected = await computeArtifactIntegrity(dir);
    const identical = await computeArtifactIntegrity(dir);
    assert.equal(compareArtifactIntegrity(identical, expected).valid, true);

    const tampered = { ...expected, manifestHash: 'x'.repeat(64), files: { ...expected.files, 'index.html': 'y'.repeat(64) } };
    const result = compareArtifactIntegrity(tampered, expected);
    assert.equal(result.valid, false);
    assert.deepEqual(result.changed, ['index.html']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('saveArtifactIntegrity accepts an explicit manifest path override', async () => {
  const dir = await makeBuildOutput();
  const customPath = join(dir, '..', `custom-${Date.now()}.json`);
  try {
    const integrity = await computeArtifactIntegrity(dir);
    await saveArtifactIntegrity(dir, integrity, customPath);
    const loaded = await loadArtifactIntegrity(customPath);
    assert.equal(loaded.manifestHash, integrity.manifestHash);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(customPath, { force: true });
  }
});
