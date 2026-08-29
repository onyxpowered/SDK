// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockPreview } from './Preview.js';
import { createTunnelClient } from '../Platform/Works/Interworks/Subworks/Tunnel/Client.js';

async function withMockPreview(run) {
  const preview = createMockPreview({ port: 0 });
  const { url } = await preview.listen();
  try {
    await run({ preview, url });
  } finally {
    await preview.close();
  }
}

test('mock Preview: /api/login accepts any email/password and returns a token, accountId, and echoed email', async () => {
  await withMockPreview(async ({ url }) => {
    const response = await fetch(`${url}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'dev@example.com', password: 'anything' }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.email, 'dev@example.com');
    assert.ok(body.accountId);
    assert.ok(body.token);
  });
});

test('mock Preview: /api/signup behaves the same as /api/login -- a local mock has no real accounts to distinguish', async () => {
  await withMockPreview(async ({ url }) => {
    const response = await fetch(`${url}/api/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'new@example.com', password: 'x' }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).email, 'new@example.com');
  });
});

test('mock Preview: rejects a login/signup body missing email or password', async () => {
  await withMockPreview(async ({ url }) => {
    const response = await fetch(`${url}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'only-email@example.com' }),
    });
    assert.equal(response.status, 400);
  });
});

test('mock Preview: /healthz reports ok', async () => {
  await withMockPreview(async ({ url }) => {
    const response = await fetch(`${url}/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  });
});

test('mock Preview: a real Ship tunnel client connects, gets a helloAck with a matching previewUrl', async () => {
  await withMockPreview(async ({ url, preview }) => {
    const wsUrl = url.replace('http://', 'ws://');
    const tunnel = createTunnelClient({
      url: wsUrl,
      token: 'test-token',
      appSlug: 'my-app',
      requestHandler: async () => ({ statusCode: 200, headers: {}, body: 'ok' }),
    });
    try {
      const helloAck = await new Promise((resolve) => tunnel.once('helloAck', resolve));
      assert.equal(helloAck.previewUrl, `${url}/my-app`);
      assert.ok(helloAck.sessionId);
      assert.deepEqual(preview.connectedAppSlugs(), ['my-app']);
    } finally {
      await tunnel.close();
    }
  });
});

test('mock Preview: proxies a real HTTP request through the tunnel to the app\'s requestHandler and back', async () => {
  await withMockPreview(async ({ url }) => {
    const wsUrl = url.replace('http://', 'ws://');
    const tunnel = createTunnelClient({
      url: wsUrl,
      token: 'test-token',
      appSlug: 'my-app',
      requestHandler: async (request) => {
        assert.equal(request.method, 'GET');
        assert.equal(request.url, '/hello');
        return { statusCode: 200, headers: { 'content-type': 'text/plain' }, body: 'Shipped.' };
      },
    });
    try {
      await new Promise((resolve) => tunnel.once('helloAck', resolve));
      const response = await fetch(`${url}/my-app/hello`);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), 'Shipped.');
    } finally {
      await tunnel.close();
    }
  });
});

test('mock Preview: a request for an appSlug with no connected tunnel fails loud (502), not silently hangs', async () => {
  await withMockPreview(async ({ url }) => {
    const response = await fetch(`${url}/never-deployed/anything`);
    assert.equal(response.status, 502);
  });
});

test('mock Preview: a requestHandler error on the app side surfaces as a 504 to the HTTP caller, not a hang', async () => {
  await withMockPreview(async ({ url }) => {
    const wsUrl = url.replace('http://', 'ws://');
    const tunnel = createTunnelClient({
      url: wsUrl,
      token: 'test-token',
      appSlug: 'broken-app',
      requestHandler: async () => {
        throw new Error('the app blew up');
      },
    });
    try {
      await new Promise((resolve) => tunnel.once('helloAck', resolve));
      const response = await fetch(`${url}/broken-app/anything`);
      assert.equal(response.status, 504);
      assert.match((await response.json()).error, /the app blew up/);
    } finally {
      await tunnel.close();
    }
  });
});

test('mock Preview: disconnecting the tunnel drops it from connectedAppSlugs', async () => {
  await withMockPreview(async ({ url, preview }) => {
    const wsUrl = url.replace('http://', 'ws://');
    const tunnel = createTunnelClient({
      url: wsUrl,
      token: 'test-token',
      appSlug: 'my-app',
      requestHandler: async () => ({ statusCode: 200, headers: {}, body: '' }),
      reconnect: { initialDelayMs: 100000 }, // don't let it reconnect mid-assertion
    });
    await new Promise((resolve) => tunnel.once('helloAck', resolve));
    assert.deepEqual(preview.connectedAppSlugs(), ['my-app']);
    await tunnel.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(preview.connectedAppSlugs(), []);
  });
});
