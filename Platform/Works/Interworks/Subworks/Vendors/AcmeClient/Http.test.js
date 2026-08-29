// SDK
// Designed & Built By onyxpowered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { acmeRequest, nonceFromHeaders, locationFromHeaders, linksFromHeaders } from './Http.js';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

test('acmeRequest parses a JSON response body into data', async () => {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ hello: 'world' }));
  });
  try {
    const base = await listen(server);
    const resp = await acmeRequest(base);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data, { hello: 'world' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('acmeRequest falls back to the raw text when the body is not valid JSON', async () => {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/pem-certificate-chain' });
    res.end('-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----\n');
  });
  try {
    const base = await listen(server);
    const resp = await acmeRequest(base);
    assert.match(resp.data, /BEGIN CERTIFICATE/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('acmeRequest returns data:null for an empty body', async () => {
  const server = createServer((req, res) => {
    res.writeHead(204);
    res.end();
  });
  try {
    const base = await listen(server);
    const resp = await acmeRequest(base);
    assert.equal(resp.data, null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('acmeRequest sends the requested method, headers and body', async () => {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ method: req.method, contentType: req.headers['content-type'], body }));
    });
  });
  try {
    const base = await listen(server);
    const resp = await acmeRequest(base, {
      method: 'POST',
      headers: { 'content-type': 'application/jose+json' },
      body: JSON.stringify({ a: 1 }),
    });
    assert.equal(resp.data.method, 'POST');
    assert.equal(resp.data.contentType, 'application/jose+json');
    assert.equal(resp.data.body, JSON.stringify({ a: 1 }));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('nonceFromHeaders/locationFromHeaders read the replay-nonce and location headers', async () => {
  const server = createServer((req, res) => {
    res.writeHead(201, { 'replay-nonce': 'nonce-123', location: 'https://acme.test/acct/1' });
    res.end();
  });
  try {
    const base = await listen(server);
    const resp = await acmeRequest(base);
    assert.equal(nonceFromHeaders(resp.headers), 'nonce-123');
    assert.equal(locationFromHeaders(resp.headers), 'https://acme.test/acct/1');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('linksFromHeaders extracts URLs matching a given rel from a Link header', async () => {
  const server = createServer((req, res) => {
    res.writeHead(200, {
      link: '<https://acme.test/terms>; rel="terms-of-service", <https://acme.test/directory>; rel="index"',
    });
    res.end();
  });
  try {
    const base = await listen(server);
    const resp = await acmeRequest(base);
    assert.deepEqual(linksFromHeaders(resp.headers, 'terms-of-service'), ['https://acme.test/terms']);
    assert.deepEqual(linksFromHeaders(resp.headers, 'index'), ['https://acme.test/directory']);
    assert.deepEqual(linksFromHeaders(resp.headers, 'missing'), []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('linksFromHeaders returns an empty array when there is no Link header at all', async () => {
  const server = createServer((req, res) => {
    res.writeHead(200);
    res.end();
  });
  try {
    const base = await listen(server);
    const resp = await acmeRequest(base);
    assert.deepEqual(linksFromHeaders(resp.headers, 'index'), []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
