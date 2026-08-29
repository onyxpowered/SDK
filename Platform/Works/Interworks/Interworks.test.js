// SDK
// Designed & Built By onyxpowered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { createVault } from '../../Vault/Vault.js';
import { REQUIRED_VERSIONS } from '../Systemworks/Subworks/RequiredVersions.js';
import WebSocket from './Subworks/Vendors/Ws/index.js';
import { generateRsaKeyPair } from './Subworks/Crypto/Keys.js';
import { parseCertificate } from './Subworks/Crypto/X509.js';
import { makeFakeAcmeCa, startFakeAcmeServer, listenFakeAcmeServer } from './Subworks/Vendors/AcmeClient/__fixtures__/FakeAcmeServer.js';
import {
  VERSION,
  MODES,
  isValidMode,
  resolveInterworksTarget,
  validateBlockHandle,
  createStaticBlockHandle,
  getDaemonToken,
  computeArtifactIntegrity,
  getOrCreateCa,
  installCaTrust,
  startPostServer,
  createTunnelClient,
  previewUrl,
  attemptPortForward,
  bootstrapProductionRouting,
  startInterworks,
} from './Interworks.js';

test('VERSION matches Systemworks\' REQUIRED_VERSIONS entry for Interworks', () => {
  assert.equal(VERSION, REQUIRED_VERSIONS.Interworks);
});

test('the composition root re-exports the real functions from every Subworks module, not stand-ins', () => {
  assert.equal(typeof isValidMode, 'function');
  assert.equal(typeof resolveInterworksTarget, 'function');
  assert.equal(typeof validateBlockHandle, 'function');
  assert.equal(typeof createStaticBlockHandle, 'function');
  assert.equal(typeof getDaemonToken, 'function');
  assert.equal(typeof computeArtifactIntegrity, 'function');
  assert.equal(typeof getOrCreateCa, 'function');
  assert.equal(typeof installCaTrust, 'function');
  assert.equal(typeof startPostServer, 'function');
  assert.equal(typeof createTunnelClient, 'function');
  assert.equal(typeof previewUrl, 'function');
  assert.equal(typeof attemptPortForward, 'function');
  assert.equal(typeof bootstrapProductionRouting, 'function');
  assert.deepEqual(Object.keys(MODES).sort(), ['POST', 'PREVIEW', 'PRODUCTION']);
});

test('startInterworks rejects an unknown mode', async () => {
  await assert.rejects(() => startInterworks({ mode: 'staging' }), /unknown Interworks mode/);
});

test('startInterworks(Post) creates the CA/leaf and starts a real HTTPS server proxying to the Block', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ship-interworks-post-'));
  const upstream = createHttpServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('post ok');
  });
  let running;
  try {
    const vault = await createVault({ shipHome: dir, vaultDir: join(dir, 'vault') });
    const { port: upstreamPort } = await new Promise((resolve, reject) => {
      upstream.once('error', reject);
      upstream.listen(0, '127.0.0.1', () => resolve(upstream.address()));
    });
    const blockHandle = createStaticBlockHandle({ host: '127.0.0.1', port: upstreamPort });

    running = await startInterworks({
      mode: MODES.POST,
      vault,
      blockHandle,
      hostnames: ['localhost'],
      hostname: '127.0.0.1',
    });

    assert.match(running.url, /^https:\/\/127\.0\.0\.1:\d+$/);
  } finally {
    await running?.close();
    await new Promise((resolve) => upstream.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test('startInterworks(Preview) connects a tunnel client to the given Services URL', async () => {
  const server = new WebSocket.WebSocketServer({ port: 0 });
  let preview;
  try {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const { port } = server.address();
    const blockHandle = createStaticBlockHandle({ port: 65535 });

    preview = await startInterworks({
      mode: MODES.PREVIEW,
      servicesUrl: `ws://127.0.0.1:${port}`,
      token: 'tok',
      appSlug: 'my-app',
      blockHandle,
    });

    assert.equal(typeof preview.close, 'function');
    assert.equal(preview.expectedPreviewUrl, previewUrl('my-app'));
  } finally {
    preview?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('startInterworks(Production) delegates to bootstrapProductionRouting', async () => {
  const ca = await makeFakeAcmeCa();
  const { server } = startFakeAcmeServer({ ca });
  const upstream = createHttpServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('production ok');
  });
  let running;
  try {
    const directoryUrl = `${await listenFakeAcmeServer(server)}/directory`;
    const { port: upstreamPort } = await new Promise((resolve, reject) => {
      upstream.once('error', reject);
      upstream.listen(0, '127.0.0.1', () => resolve(upstream.address()));
    });
    const blockHandle = createStaticBlockHandle({ host: '127.0.0.1', port: upstreamPort });

    running = await startInterworks({
      mode: MODES.PRODUCTION,
      domain: 'interworks-composition.local',
      accountKey: generateRsaKeyPair(2048),
      leafKey: generateRsaKeyPair(2048),
      blockHandle,
      directoryUrl,
      httpsPort: 0,
      challengePort: 0,
      attemptForwarding: false,
      pollOptions: { intervalMs: 5, timeoutMs: 2000 },
    });

    const cert = parseCertificate(running.certificateChainPem);
    assert.match(cert.subject, /CN=interworks-composition\.local/);
  } finally {
    await running?.close();
    await new Promise((resolve) => upstream.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  }
});
