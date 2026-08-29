// SDK
// Designed & Built By onyxpowered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { createStaticBlockHandle } from '../Block.js';
import { streamProxyRequest, streamProxyUpgrade, bufferedProxyRequest, createBlockRequestHandler } from './Proxy.js';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
  });
}

test('bufferedProxyRequest forwards method/headers/body and buffers the full response', async () => {
  const upstream = createHttpServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json', 'x-echo-method': req.method });
      res.end(JSON.stringify({ url: req.url, body }));
    });
  });
  try {
    const { port } = await listen(upstream);
    const blockHandle = createStaticBlockHandle({ port });

    const response = await bufferedProxyRequest(blockHandle, {
      method: 'POST',
      url: '/hello?x=1',
      headers: { 'content-type': 'text/plain' },
      body: Buffer.from('ping'),
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['x-echo-method'], 'POST');
    const parsed = JSON.parse(response.body.toString('utf8'));
    assert.equal(parsed.url, '/hello?x=1');
    assert.equal(parsed.body, 'ping');
  } finally {
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test('bufferedProxyRequest rejects when the Block is unreachable', async () => {
  const blockHandle = createStaticBlockHandle({ port: 1 });
  await assert.rejects(() => bufferedProxyRequest(blockHandle, { method: 'GET', url: '/' }));
});

test('bufferedProxyRequest validates the Block handle before making any request', async () => {
  await assert.rejects(() => bufferedProxyRequest({ port: 3000 }, { method: 'GET', url: '/' }), /must declare/);
});

test('createBlockRequestHandler returns a function matching the tunnel requestHandler shape', async () => {
  const upstream = createHttpServer((req, res) => {
    res.writeHead(201, { 'content-type': 'text/plain' });
    res.end('created');
  });
  try {
    const { port } = await listen(upstream);
    const blockHandle = createStaticBlockHandle({ port });
    const handler = createBlockRequestHandler(blockHandle);

    const response = await handler({ method: 'GET', url: '/', headers: {} });
    assert.equal(response.statusCode, 201);
    assert.equal(response.body.toString('utf8'), 'created');
  } finally {
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test('streamProxyRequest pipes a real HTTP request/response pair through to the Block', async () => {
  const upstream = createHttpServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`got ${req.url}`);
  });
  const front = createHttpServer((req, res) => streamProxyRequest(req, res, blockHandle));
  let blockHandle;
  try {
    const { port: upstreamPort } = await listen(upstream);
    blockHandle = createStaticBlockHandle({ port: upstreamPort });
    const { port: frontPort } = await listen(front);

    const response = await fetch(`http://127.0.0.1:${frontPort}/x`);
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.equal(text, 'got /x');
  } finally {
    await new Promise((resolve) => front.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test('streamProxyRequest returns a 502 when the Block is unreachable', async () => {
  const blockHandle = createStaticBlockHandle({ port: 1 });
  const front = createHttpServer((req, res) => streamProxyRequest(req, res, blockHandle));
  try {
    const { port } = await listen(front);
    const response = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(response.status, 502);
  } finally {
    await new Promise((resolve) => front.close(resolve));
  }
});

test('streamProxyUpgrade tunnels a raw upgrade request byte-for-byte to the Block', async () => {
  let receivedRaw = '';
  const upstream = createHttpServer();
  upstream.on('upgrade', (req, socket) => {
    let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
    for (const [key, value] of Object.entries(req.headers)) {
      raw += `${key}: ${value}\r\n`;
    }
    receivedRaw = raw;
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: custom\r\nConnection: Upgrade\r\n\r\n');
    socket.end();
  });

  const front = createHttpServer();
  let blockHandle;
  front.on('upgrade', (req, socket, head) => streamProxyUpgrade(req, socket, head, blockHandle));

  try {
    const { port: upstreamPort } = await listen(upstream);
    blockHandle = createStaticBlockHandle({ port: upstreamPort });
    const { port: frontPort } = await listen(front);

    await new Promise((resolve, reject) => {
      const req = httpRequest({
        host: '127.0.0.1',
        port: frontPort,
        path: '/socket',
        headers: { Connection: 'Upgrade', Upgrade: 'custom' },
      });
      req.on('upgrade', () => resolve());
      req.on('error', reject);
      req.end();
    });

    assert.match(receivedRaw, /^GET \/socket HTTP\/1\.1/);
    assert.match(receivedRaw, /upgrade: custom/i);
  } finally {
    await new Promise((resolve) => front.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
  }
});
