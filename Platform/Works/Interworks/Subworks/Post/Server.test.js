// SDK
// Designed & Built By onyxpowered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVault } from '../../../../Vault/Vault.js';
import { getOrCreateCa } from './Ca.js';
import { getOrCreateLeafCertificate } from './Leaf.js';
import { startPostServer } from './Server.js';
import { createStaticBlockHandle } from '../Block.js';
import WebSocket from '../Vendors/Ws/index.js';

async function makeVault() {
  const dir = await mkdtemp(join(tmpdir(), 'ship-post-server-test-'));
  const vault = await createVault({ shipHome: dir, vaultDir: join(dir, 'vault') });
  return { vault, dir };
}

function listen(server, port = 0, hostname = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, hostname, () => {
      server.removeListener('error', reject);
      resolve(server.address());
    });
  });
}

function requestJson(url, caCertPem, options = {}) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { ca: caCertPem, ...options }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('startPostServer terminates real HTTPS with the CA-issued leaf cert and proxies to the Block handle', async () => {
  const { vault, dir } = await makeVault();
  const upstream = createHttpServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`hello from ${req.url}`);
  });
  let postServer;
  try {
    const { port: upstreamPort } = await listen(upstream);
    const ca = await getOrCreateCa(vault);
    const leaf = await getOrCreateLeafCertificate(vault, ca);
    const blockHandle = createStaticBlockHandle({ name: 'web', host: '127.0.0.1', port: upstreamPort });

    postServer = await startPostServer({ leaf, blockHandle, hostname: '127.0.0.1' });
    assert.match(postServer.url, /^https:\/\/127\.0\.0\.1:\d+$/);

    const response = await requestJson(`${postServer.url}/hi`, ca.certificatePem);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body, 'hello from /hi');
  } finally {
    await postServer?.close();
    await new Promise((resolve) => upstream.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test('startPostServer returns a 502 when the Block behind it is unreachable', async () => {
  const { vault, dir } = await makeVault();
  let postServer;
  try {
    const ca = await getOrCreateCa(vault);
    const leaf = await getOrCreateLeafCertificate(vault, ca);
    const blockHandle = createStaticBlockHandle({ name: 'web', host: '127.0.0.1', port: 1 });

    postServer = await startPostServer({ leaf, blockHandle, hostname: '127.0.0.1' });
    const response = await requestJson(postServer.url, ca.certificatePem);
    assert.equal(response.statusCode, 502);
  } finally {
    await postServer?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('startPostServer passes WebSocket upgrade requests straight through to the Block', async () => {
  const { vault, dir } = await makeVault();
  const upstream = new WebSocket.WebSocketServer({ port: 0 });
  let postServer;
  try {
    upstream.on('connection', (socket) => {
      socket.on('message', (data) => socket.send(`echo:${data.toString()}`));
    });
    await new Promise((resolve, reject) => {
      upstream.once('listening', resolve);
      upstream.once('error', reject);
    });
    const { port: upstreamPort } = upstream.address();

    const ca = await getOrCreateCa(vault);
    const leaf = await getOrCreateLeafCertificate(vault, ca);
    const blockHandle = createStaticBlockHandle({ name: 'web', host: '127.0.0.1', port: upstreamPort });

    postServer = await startPostServer({ leaf, blockHandle, hostname: '127.0.0.1' });
    const wsUrl = postServer.url.replace('https://', 'wss://');
    const client = new WebSocket(wsUrl, { ca: ca.certificatePem });

    const received = await new Promise((resolve, reject) => {
      client.once('open', () => client.send('ping'));
      client.once('message', (data) => resolve(data.toString()));
      client.once('error', reject);
    });

    assert.equal(received, 'echo:ping');
    client.close();
  } finally {
    await postServer?.close();
    await new Promise((resolve) => upstream.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
