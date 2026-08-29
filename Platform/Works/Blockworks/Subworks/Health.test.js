// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { probePort, probeUrl, probeHealthCheck } from './Health.js';

function fakeSocket() {
  const emitter = new EventEmitter();
  emitter.destroy = () => {};
  return emitter;
}

test('Health: probePort resolves true when the socket connects', async () => {
  const socket = fakeSocket();
  const connectFn = () => {
    setImmediate(() => socket.emit('connect'));
    return socket;
  };
  const result = await probePort(3000, { connectFn });
  assert.equal(result, true);
});

test('Health: probePort resolves false when the socket errors', async () => {
  const socket = fakeSocket();
  const connectFn = () => {
    setImmediate(() => socket.emit('error', new Error('ECONNREFUSED')));
    return socket;
  };
  const result = await probePort(3000, { connectFn });
  assert.equal(result, false);
});

test('Health: probePort resolves false when nothing happens before the timeout', async () => {
  const socket = fakeSocket();
  const connectFn = () => socket;
  const result = await probePort(3000, { connectFn, timeoutMs: 20 });
  assert.equal(result, false);
});

test('Health: probePort against a real listening TCP server resolves true', async () => {
  const server = createServer((socket) => socket.end());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const result = await probePort(port);
    assert.equal(result, true);
  } finally {
    server.close();
  }
});

test('Health: probePort against a port nothing listens on resolves false', async () => {
  const server = createServer(() => {});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  server.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const result = await probePort(port, { timeoutMs: 300 });
  assert.equal(result, false);
});

test('Health: probeUrl resolves true for a healthy (< 500) response', async () => {
  const fetchImpl = async () => ({ status: 200 });
  assert.equal(await probeUrl('http://localhost:3000/health', { fetchImpl }), true);
});

test('Health: probeUrl treats a 4xx as a live-but-degraded probe result, still true', async () => {
  const fetchImpl = async () => ({ status: 404 });
  assert.equal(await probeUrl('http://localhost:3000/health', { fetchImpl }), true);
});

test('Health: probeUrl resolves false for a 5xx server error', async () => {
  const fetchImpl = async () => ({ status: 503 });
  assert.equal(await probeUrl('http://localhost:3000/health', { fetchImpl }), false);
});

test('Health: probeUrl resolves false when fetch rejects (connection refused)', async () => {
  const fetchImpl = async () => {
    throw new Error('ECONNREFUSED');
  };
  assert.equal(await probeUrl('http://localhost:3000/health', { fetchImpl }), false);
});

test('Health: probeUrl against a real HTTP server resolves true', async () => {
  const server = createHttpServer((req, res) => res.end('ok'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const result = await probeUrl(`http://127.0.0.1:${port}/`);
    assert.equal(result, true);
  } finally {
    server.close();
  }
});

test('Health: probeHealthCheck returns true immediately when no healthCheck is declared', async () => {
  assert.equal(await probeHealthCheck(null), true);
  assert.equal(await probeHealthCheck(undefined), true);
});

test('Health: probeHealthCheck dispatches to probePort when a port is declared', async () => {
  const socket = fakeSocket();
  const connectFn = () => {
    setImmediate(() => socket.emit('connect'));
    return socket;
  };
  const result = await probeHealthCheck({ port: 3000 }, { connectFn });
  assert.equal(result, true);
});

test('Health: probeHealthCheck dispatches to probeUrl when a url is declared', async () => {
  const fetchImpl = async () => ({ status: 200 });
  const result = await probeHealthCheck({ url: 'http://localhost:3000/health' }, { fetchImpl });
  assert.equal(result, true);
});

test('Health: probeHealthCheck passes a declared timeoutMs through to the underlying probe', async () => {
  const socket = fakeSocket();
  const connectFn = () => socket;
  const startedAt = Date.now();
  const result = await probeHealthCheck({ port: 3000, timeoutMs: 30 }, { connectFn });
  const elapsedMs = Date.now() - startedAt;
  assert.equal(result, false);
  assert.ok(elapsedMs < 500, `expected the declared 30ms timeout to be honored, took ${elapsedMs}ms`);
});
