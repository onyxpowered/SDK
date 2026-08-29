// SDK
// Designed & Built By onyxpowered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import WebSocket from '../Vendors/Ws/index.js';
import { decodeMessage, encodeMessage, createRequestMessage, createHelloAckMessage, MESSAGE_TYPES } from '../Tunnel/Protocol.js';
import { createStaticBlockHandle } from '../Block.js';
import {
  DEFAULT_PREVIEW_DOMAIN,
  SHIP_BASE_PATH_ENV_VAR,
  previewPath,
  previewUrl,
  shipBasePathEnv,
  mergeBlockEnv,
  createPreviewTunnel,
} from './Preview.js';

test('previewPath rejects an empty appSlug and slashes a valid one', () => {
  assert.throws(() => previewPath(''), /non-empty appSlug/);
  assert.equal(previewPath('my-first-project'), '/my-first-project');
});

test('previewUrl builds a path-based URL under the default preview domain', () => {
  assert.equal(previewUrl('my-first-project'), `https://${DEFAULT_PREVIEW_DOMAIN}/my-first-project`);
});

test('previewUrl accepts a custom preview domain override', () => {
  assert.equal(previewUrl('my-app', 'preview.staging.test'), 'https://preview.staging.test/my-app');
});

test('shipBasePathEnv injects SHIP_BASE_PATH matching the preview path', () => {
  const env = shipBasePathEnv('my-first-project');
  assert.deepEqual(env, { [SHIP_BASE_PATH_ENV_VAR]: '/my-first-project' });
});

test('mergeBlockEnv layers SHIP_BASE_PATH on top of the Block\'s existing env without dropping other vars', () => {
  const merged = mergeBlockEnv({ NODE_ENV: 'production', PORT: '3000' }, 'my-app');
  assert.equal(merged.NODE_ENV, 'production');
  assert.equal(merged.PORT, '3000');
  assert.equal(merged[SHIP_BASE_PATH_ENV_VAR], '/my-app');
});

function startFakeServices() {
  const server = new WebSocket.WebSocketServer({ port: 0 });
  return new Promise((resolve, reject) => {
    server.once('listening', () => resolve({ server, url: `ws://127.0.0.1:${server.address().port}` }));
    server.once('error', reject);
  });
}

test('createPreviewTunnel validates the Block handle before connecting', () => {
  assert.throws(
    () => createPreviewTunnel({ servicesUrl: 'ws://x', token: 't', appSlug: 'a', blockHandle: { port: 3000 } }),
    /must declare/,
  );
});

test('createPreviewTunnel sends a hello handshake with mode "preview" and the given appSlug', async () => {
  const { server, url } = await startFakeServices();
  let preview;
  try {
    const helloReceived = new Promise((resolve) => {
      server.once('connection', (socket) => {
        socket.once('message', (data) => resolve(decodeMessage(data)));
      });
    });

    const blockHandle = createStaticBlockHandle({ port: 65535 });
    preview = createPreviewTunnel({ servicesUrl: url, token: 'tok', appSlug: 'my-app', blockHandle });

    const hello = await helloReceived;
    assert.equal(hello.mode, 'preview');
    assert.equal(hello.appSlug, 'my-app');
    assert.equal(hello.token, 'tok');
    assert.equal(preview.expectedPreviewUrl, `https://${DEFAULT_PREVIEW_DOMAIN}/my-app`);
  } finally {
    preview?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createPreviewTunnel records the Services-assigned preview URL from helloAck', async () => {
  const { server, url } = await startFakeServices();
  let preview;
  try {
    const connectionPromise = new Promise((resolve) => server.once('connection', resolve));
    const blockHandle = createStaticBlockHandle({ port: 65535 });
    preview = createPreviewTunnel({ servicesUrl: url, token: 'tok', appSlug: 'my-app', blockHandle });

    const socket = await connectionPromise;
    assert.equal(preview.assignedPreviewUrl(), null);

    socket.send(encodeMessage(createHelloAckMessage({ previewUrl: 'https://preview.onyxpowered.com/my-app-2', sessionId: 's1' })));

    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(preview.assignedPreviewUrl(), 'https://preview.onyxpowered.com/my-app-2');
  } finally {
    preview?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createPreviewTunnel proxies an incoming REQUEST message to the real Block behind the handle', async () => {
  const { server, url } = await startFakeServices();
  const upstream = createHttpServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`preview says: ${req.url}`);
  });
  let preview;
  try {
    const { port: upstreamPort } = await new Promise((resolve, reject) => {
      upstream.once('error', reject);
      upstream.listen(0, '127.0.0.1', () => resolve(upstream.address()));
    });

    const blockHandle = createStaticBlockHandle({ host: '127.0.0.1', port: upstreamPort });
    const connectionPromise = new Promise((resolve) => server.once('connection', resolve));
    preview = createPreviewTunnel({ servicesUrl: url, token: 'tok', appSlug: 'my-app', blockHandle });

    const socket = await connectionPromise;
    const responsePromise = new Promise((resolve) => {
      socket.on('message', (data) => {
        const message = decodeMessage(data);
        if (message.type === MESSAGE_TYPES.RESPONSE) resolve(message);
      });
    });

    socket.send(encodeMessage(createRequestMessage({ id: 'r1', method: 'GET', url: '/my-app/page' })));
    const response = await responsePromise;
    assert.equal(response.statusCode, 200);
    assert.equal(Buffer.from(response.body, 'base64').toString('utf8'), 'preview says: /my-app/page');
  } finally {
    preview?.close();
    await new Promise((resolve) => upstream.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  }
});
