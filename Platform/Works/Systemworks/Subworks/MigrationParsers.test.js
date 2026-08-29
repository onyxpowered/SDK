// SDK
// Designed & Built By onyxpowered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseProcfile, parseVercelJson, parseDockerCompose, detectMigrationSource } from './MigrationParsers.js';

async function tempDir() {
  return mkdtemp(join(tmpdir(), 'ship-migrate-'));
}

test('parseProcfile: reads a standard Heroku Procfile, marks web as exposed', async () => {
  const dir = await tempDir();
  await writeFile(join(dir, 'Procfile'), 'web: node server.js\nworker: node worker.js\n');
  const result = parseProcfile(dir);
  assert.equal(result.blocks.web.command, 'node server.js');
  assert.equal(result.blocks.web.expose, true);
  assert.equal(result.blocks.worker.command, 'node worker.js');
  assert.equal(result.blocks.worker.expose, false);
});

test('parseProcfile: ignores comments and blank lines', async () => {
  const dir = await tempDir();
  await writeFile(join(dir, 'Procfile'), '# comment\n\nweb: npm start\n');
  const result = parseProcfile(dir);
  assert.deepEqual(Object.keys(result.blocks), ['web']);
});

test('parseProcfile: returns null when no Procfile exists', async () => {
  const dir = await tempDir();
  assert.equal(parseProcfile(dir), null);
});

test('parseVercelJson: builds a combined build+start command when both are present', async () => {
  const dir = await tempDir();
  await writeFile(join(dir, 'vercel.json'), JSON.stringify({ buildCommand: 'npm run build', startCommand: 'npm run serve' }));
  const result = parseVercelJson(dir);
  assert.equal(result.blocks.web.command, 'npm run build && npm run serve');
  assert.equal(result.blocks.web.expose, true);
});

test('parseVercelJson: falls back to npm start and flags the fallback with a note', async () => {
  const dir = await tempDir();
  await writeFile(join(dir, 'vercel.json'), JSON.stringify({ framework: 'nextjs' }));
  const result = parseVercelJson(dir);
  assert.equal(result.blocks.web.command, 'npm start');
  assert.ok(result.note && result.note.includes('verify'));
});

test('parseDockerCompose: reads a service command as an inline scalar', async () => {
  const dir = await tempDir();
  await writeFile(
    join(dir, 'docker-compose.yml'),
    'services:\n  web:\n    command: node server.js\n    ports:\n      - "3000:3000"\n',
  );
  const result = parseDockerCompose(dir);
  assert.equal(result.blocks.web.command, 'node server.js');
  assert.equal(result.blocks.web.expose, true);
});

test('parseDockerCompose: reads a service command given as a YAML list', async () => {
  const dir = await tempDir();
  await writeFile(
    join(dir, 'docker-compose.yml'),
    'services:\n  api:\n    command:\n      - node\n      - server.js\n',
  );
  const result = parseDockerCompose(dir);
  assert.equal(result.blocks.api.command, 'node server.js');
});

test('parseDockerCompose: reads multiple services and exposes only web', async () => {
  const dir = await tempDir();
  await writeFile(
    join(dir, 'docker-compose.yml'),
    'services:\n  web:\n    command: npm start\n  worker:\n    command: npm run worker\n',
  );
  const result = parseDockerCompose(dir);
  assert.equal(result.blocks.web.expose, true);
  assert.equal(result.blocks.worker.expose, false);
});

test('parseDockerCompose: a service with no command gets a clear placeholder, not silently dropped', async () => {
  const dir = await tempDir();
  await writeFile(join(dir, 'docker-compose.yml'), 'services:\n  db:\n    image: postgres:16\n');
  const result = parseDockerCompose(dir);
  assert.match(result.blocks.db.command, /no command found/);
});

test('parseDockerCompose: returns null when no compose file exists', async () => {
  const dir = await tempDir();
  assert.equal(parseDockerCompose(dir), null);
});

test('detectMigrationSource: prefers Procfile over vercel.json when both exist', async () => {
  const dir = await tempDir();
  await writeFile(join(dir, 'Procfile'), 'web: node a.js\n');
  await writeFile(join(dir, 'vercel.json'), JSON.stringify({}));
  const result = detectMigrationSource(dir);
  assert.equal(result.source, 'heroku (Procfile)');
});

test('detectMigrationSource: returns null when nothing migratable is present', async () => {
  const dir = await tempDir();
  assert.equal(detectMigrationSource(dir), null);
});
