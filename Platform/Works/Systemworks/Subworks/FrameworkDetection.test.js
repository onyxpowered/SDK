// SDK
// Designed & Built By onyxpowered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectFramework, listSignatureNames } from './FrameworkDetection.js';

async function tempDir() {
  return mkdtemp(join(tmpdir(), 'ship-fwdetect-'));
}

test('FrameworkDetection: detects Next.js from package.json dependency', async () => {
  const dir = await tempDir();
  await writeFile(join(dir, 'package.json'), JSON.stringify({ dependencies: { next: '14.0.0' } }));
  const result = detectFramework(dir);
  assert.equal(result.name, 'next');
});

test('FrameworkDetection: detects Express as a distinct signature from generic Node', async () => {
  const dir = await tempDir();
  await writeFile(join(dir, 'package.json'), JSON.stringify({ dependencies: { express: '4.0.0' } }));
  const result = detectFramework(dir);
  assert.equal(result.name, 'express');
});

test('FrameworkDetection: falls back to node-generic for a bare package.json with a start script', async () => {
  const dir = await tempDir();
  await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { start: 'node server.js' } }));
  const result = detectFramework(dir);
  assert.equal(result.name, 'node-generic');
  assert.equal(result.command, 'npm start');
});

test('FrameworkDetection: detects a static site via index.html when no package.json exists', async () => {
  const dir = await tempDir();
  await writeFile(join(dir, 'index.html'), '<html></html>');
  const result = detectFramework(dir);
  assert.equal(result.name, 'static');
});

test('FrameworkDetection: detects a plain HTML file that isn\'t named index.html', async () => {
  const dir = await tempDir();
  await writeFile(join(dir, 'page.html'), '<html><body>hi</body></html>');
  const result = detectFramework(dir);
  assert.equal(result.name, 'plain-html');
  assert.equal(result.port, 8080);
  assert.equal(result.command, 'cp "page.html" index.html && npx --yes serve -l 8080 .');
});

test('FrameworkDetection: prefers the static signature over plain-html when index.html is present', async () => {
  const dir = await tempDir();
  await writeFile(join(dir, 'index.html'), '<html></html>');
  await writeFile(join(dir, 'other.html'), '<html></html>');
  const result = detectFramework(dir);
  assert.equal(result.name, 'static');
});

test('FrameworkDetection: detects Flask via requirements.txt + app.py', async () => {
  const dir = await tempDir();
  await writeFile(join(dir, 'requirements.txt'), 'flask\n');
  await writeFile(join(dir, 'app.py'), 'app = None\n');
  const result = detectFramework(dir);
  assert.equal(result.name, 'flask');
});

test('FrameworkDetection: returns null for a directory with nothing recognizable', async () => {
  const dir = await tempDir();
  await mkdir(join(dir, 'empty-subdir'));
  const result = detectFramework(dir);
  assert.equal(result, null);
});

test('FrameworkDetection: node-generic uses package.json main field when no start script exists', async () => {
  const dir = await tempDir();
  await writeFile(join(dir, 'package.json'), JSON.stringify({ main: 'entry.js' }));
  const result = detectFramework(dir);
  assert.equal(result.command, 'node entry.js');
});

test('FrameworkDetection: listSignatureNames returns every registered signature name', () => {
  const names = listSignatureNames();
  assert.ok(names.includes('next'));
  assert.ok(names.includes('static'));
  assert.ok(names.includes('node-generic'));
});
