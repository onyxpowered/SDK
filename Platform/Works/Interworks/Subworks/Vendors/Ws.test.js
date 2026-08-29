// SDK
// Designed & Built By onyxpowered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from './Ws/index.js';

test('vendored ws exposes WebSocket, Server and WebSocketServer', () => {
  assert.equal(typeof WebSocket, 'function');
  assert.equal(WebSocket.Server, WebSocket.WebSocketServer);
  assert.equal(typeof WebSocket.WebSocketServer, 'function');
});

test('vendored ws can open a connection and exchange a message', async () => {
  const server = new WebSocket.WebSocketServer({ port: 0 });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  server.on('connection', (socket) => {
    socket.on('message', (data) => {
      socket.send(`echo:${data.toString()}`);
    });
  });

  const { port } = server.address();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);

  try {
    const received = await new Promise((resolve, reject) => {
      client.once('open', () => client.send('hello'));
      client.once('message', (data) => resolve(data.toString()));
      client.once('error', reject);
    });

    assert.equal(received, 'echo:hello');
  } finally {
    client.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
