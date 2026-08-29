// SDK
// Designed & Built By onyxpowered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from '../Vendors/Ws/index.js';
import { createTunnelClient } from './Client.js';
import { MESSAGE_TYPES, decodeMessage, encodeMessage, createRequestMessage, createHelloAckMessage, createPingMessage } from './Protocol.js';

function startFakeServices() {
  const server = new WebSocket.WebSocketServer({ port: 0 });
  return new Promise((resolve, reject) => {
    server.once('listening', () => {
      const { port } = server.address();
      resolve({ server, url: `ws://127.0.0.1:${port}` });
    });
    server.once('error', reject);
  });
}

test('createTunnelClient connects and sends a hello handshake carrying the token/appSlug/mode', async () => {
  const { server, url } = await startFakeServices();
  let client;
  try {
    const helloReceived = new Promise((resolve) => {
      server.once('connection', (socket) => {
        socket.once('message', (data) => resolve(decodeMessage(data)));
      });
    });

    client = createTunnelClient({
      url,
      token: 'tok_123',
      appSlug: 'my-app',
      mode: 'preview',
      requestHandler: async () => ({ statusCode: 200, headers: {}, body: 'ok' }),
    });

    const hello = await helloReceived;
    assert.equal(hello.type, MESSAGE_TYPES.HELLO);
    assert.equal(hello.token, 'tok_123');
    assert.equal(hello.appSlug, 'my-app');
    assert.equal(hello.mode, 'preview');
  } finally {
    client?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('createTunnelClient emits "open" and reports isConnected() once the socket is up', async () => {
  const { server, url } = await startFakeServices();
  let client;
  try {
    client = createTunnelClient({
      url,
      token: 't',
      appSlug: 'app',
      requestHandler: async () => ({ statusCode: 200 }),
    });

    await new Promise((resolve) => client.on('open', resolve));
    assert.equal(client.isConnected(), true);
  } finally {
    client?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a REQUEST message is answered by calling requestHandler and sending a RESPONSE with the same id', async () => {
  const { server, url } = await startFakeServices();
  let client;
  try {
    const connectionPromise = new Promise((resolve) => server.once('connection', resolve));
    client = createTunnelClient({
      url,
      token: 't',
      appSlug: 'app',
      requestHandler: async (request) => {
        assert.equal(request.method, 'GET');
        assert.equal(request.url, '/hello');
        return { statusCode: 200, headers: { 'content-type': 'text/plain' }, body: 'world' };
      },
    });

    const socket = await connectionPromise;
    const responsePromise = new Promise((resolve) => {
      socket.on('message', (data) => {
        const message = decodeMessage(data);
        if (message.type === MESSAGE_TYPES.RESPONSE) resolve(message);
      });
    });

    socket.send(encodeMessage(createRequestMessage({ id: 'req-1', method: 'GET', url: '/hello' })));

    const response = await responsePromise;
    assert.equal(response.id, 'req-1');
    assert.equal(response.statusCode, 200);
    assert.equal(Buffer.from(response.body, 'base64').toString('utf8'), 'world');
  } finally {
    client?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a requestHandler that throws produces an ERROR message carrying the same request id', async () => {
  const { server, url } = await startFakeServices();
  let client;
  try {
    const connectionPromise = new Promise((resolve) => server.once('connection', resolve));
    client = createTunnelClient({
      url,
      token: 't',
      appSlug: 'app',
      requestHandler: async () => {
        throw new Error('upstream exploded');
      },
    });

    const socket = await connectionPromise;
    const errorPromise = new Promise((resolve) => {
      socket.on('message', (data) => {
        const message = decodeMessage(data);
        if (message.type === MESSAGE_TYPES.ERROR) resolve(message);
      });
    });

    socket.send(encodeMessage(createRequestMessage({ id: 'req-2', method: 'GET', url: '/boom' })));
    const error = await errorPromise;
    assert.equal(error.id, 'req-2');
    assert.match(error.message, /upstream exploded/);
  } finally {
    client?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a PING message is answered with a PONG automatically', async () => {
  const { server, url } = await startFakeServices();
  let client;
  try {
    const connectionPromise = new Promise((resolve) => server.once('connection', resolve));
    client = createTunnelClient({ url, token: 't', appSlug: 'app', requestHandler: async () => ({ statusCode: 200 }) });

    const socket = await connectionPromise;
    const pongPromise = new Promise((resolve) => {
      socket.on('message', (data) => {
        const message = decodeMessage(data);
        if (message.type === MESSAGE_TYPES.PONG) resolve(message);
      });
    });

    socket.send(encodeMessage(createPingMessage()));
    await pongPromise;
  } finally {
    client?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('non-request/ping message types (like helloAck) are surfaced as events for the caller to observe', async () => {
  const { server, url } = await startFakeServices();
  let client;
  try {
    const connectionPromise = new Promise((resolve) => server.once('connection', resolve));
    client = createTunnelClient({ url, token: 't', appSlug: 'app', requestHandler: async () => ({ statusCode: 200 }) });

    const socket = await connectionPromise;
    const ackPromise = new Promise((resolve) => client.on(MESSAGE_TYPES.HELLO_ACK, resolve));
    socket.send(encodeMessage(createHelloAckMessage({ previewUrl: 'https://preview.onyxpowered.com/my-app', sessionId: 's1' })));

    const ack = await ackPromise;
    assert.equal(ack.previewUrl, 'https://preview.onyxpowered.com/my-app');
  } finally {
    client?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('the client reconnects with backoff after the server drops the connection', async () => {
  const { server, url } = await startFakeServices();
  let client;
  try {
    let connectionCount = 0;
    server.on('connection', (socket) => {
      connectionCount += 1;
      if (connectionCount <= 2) {
        socket.close();
      }
    });

    client = createTunnelClient({
      url,
      token: 't',
      appSlug: 'app',
      requestHandler: async () => ({ statusCode: 200 }),
      reconnect: { initialDelayMs: 5, maxDelayMs: 20, factor: 2 },
    });

    await new Promise((resolve) => {
      let opens = 0;
      client.on('open', () => {
        opens += 1;
        if (opens >= 3) resolve();
      });
    });

    assert.ok(connectionCount >= 3);
  } finally {
    client?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('close() stops reconnection attempts', async () => {
  const { server, url } = await startFakeServices();
  try {
    const client = createTunnelClient({
      url,
      token: 't',
      appSlug: 'app',
      requestHandler: async () => ({ statusCode: 200 }),
      reconnect: { initialDelayMs: 5, maxDelayMs: 10, factor: 2 },
    });

    await new Promise((resolve) => client.on('open', resolve));
    client.close();

    let reconnectedAfterClose = false;
    client.on('reconnecting', () => {
      reconnectedAfterClose = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(reconnectedAfterClose, false);
    assert.equal(client.isConnected(), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('calling close() before the connection finishes establishing never crashes, even with no error listener attached', async () => {
  const { server, url } = await startFakeServices();
  try {
    const client = createTunnelClient({
      url,
      token: 't',
      appSlug: 'app',
      requestHandler: async () => ({ statusCode: 200 }),
    });

    client.close();

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(client.isConnected(), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
