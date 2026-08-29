// SDK
// Designed & Built By onyxpowered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateRsaKeyPair, generateEcKeyPair } from '../../Crypto/Keys.js';
import { parseCertificate } from '../../Crypto/X509.js';
import { createAcmeClient, acmeError } from './Client.js';
import { makeFakeAcmeCa, startFakeAcmeServer, listenFakeAcmeServer } from './__fixtures__/FakeAcmeServer.js';

function hasOpenssl() {
  try {
    execFileSync('openssl', ['version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

test('createAcmeClient runs the full RFC 8555 happy path against a local fake ACME server', async () => {
  const ca = await makeFakeAcmeCa();
  const { server, finalizeCsrs } = startFakeAcmeServer({ ca });
  try {
    const directoryUrl = `${await listenFakeAcmeServer(server)}/directory`;
    const accountKey = generateRsaKeyPair(2048);

    const client = createAcmeClient({ directoryUrl, accountKey });

    const { kid, account } = await client.createAccount({ contact: ['mailto:dev@onyxlabs.test'] });
    assert.match(kid, /\/acct\//);
    assert.equal(account.status, 'valid');

    const { orderUrl, order } = await client.createOrder(['ship-acme-test.local']);
    assert.equal(order.status, 'pending');
    assert.equal(order.authorizations.length, 1);

    const authz = await client.getAuthorization(order.authorizations[0]);
    const challenge = authz.challenges.find((c) => c.type === 'http-01');
    assert.ok(challenge);

    const keyAuthorization = client.keyAuthorizationFor(challenge.token);
    assert.equal(keyAuthorization.split('.').length, 2);

    await client.respondToChallenge(challenge.url);

    const readyOrder = await client.waitForOrderReady(orderUrl, { intervalMs: 5, timeoutMs: 2000 });
    assert.equal(readyOrder.status, 'ready');

    const leafKeys = generateRsaKeyPair(2048);
    await client.finalizeOrder(readyOrder, {
      leafPrivateKey: leafKeys.privateKey,
      leafPublicKey: leafKeys.publicKey,
      altNames: ['ship-acme-test.local'],
    });

    const validOrder = await client.waitForOrderValid(orderUrl, { intervalMs: 5, timeoutMs: 2000 });
    assert.equal(validOrder.status, 'valid');
    assert.match(validOrder.certificate, /\/cert\//);

    const certificateChainPem = await client.downloadCertificate(validOrder.certificate);
    assert.match(certificateChainPem, /-----BEGIN CERTIFICATE-----/);

    const issuedCert = parseCertificate(certificateChainPem);
    assert.match(issuedCert.subject, /CN=ship-acme-test.local/);
    assert.equal(issuedCert.checkPrivateKey(leafKeys.privateKey), true);

    assert.equal(finalizeCsrs.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('the CSR finalizeOrder submits is a valid, openssl-verifiable PKCS#10 request', { skip: !hasOpenssl() }, async () => {
  const ca = await makeFakeAcmeCa();
  const { server, finalizeCsrs } = startFakeAcmeServer({ ca });
  try {
    const directoryUrl = `${await listenFakeAcmeServer(server)}/directory`;
    const accountKey = generateRsaKeyPair(2048);
    const client = createAcmeClient({ directoryUrl, accountKey });

    await client.createAccount();
    const { orderUrl, order } = await client.createOrder(['csr-check.local']);
    const authz = await client.getAuthorization(order.authorizations[0]);
    const challenge = authz.challenges[0];
    await client.respondToChallenge(challenge.url);
    const readyOrder = await client.waitForOrderReady(orderUrl, { intervalMs: 5, timeoutMs: 2000 });

    const leafKeys = generateRsaKeyPair(2048);
    await client.finalizeOrder(readyOrder, {
      leafPrivateKey: leafKeys.privateKey,
      leafPublicKey: leafKeys.publicKey,
      altNames: ['csr-check.local'],
    });

    const csrDer = finalizeCsrs[0];
    const dir = mkdtempSync(join(tmpdir(), 'ship-acme-csr-'));
    const csrPath = join(dir, 'req.der');
    writeFileSync(csrPath, csrDer);
    const output = execFileSync('openssl', ['req', '-in', csrPath, '-inform', 'DER', '-verify', '-noout', '-text'], {
      encoding: 'utf8',
    });
    assert.match(output, /DNS:csr-check\.local/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a bad-nonce response is retried automatically with a fresh nonce', async () => {
  const ca = await makeFakeAcmeCa();
  const { server } = startFakeAcmeServer({ ca });
  try {
    const directoryUrl = `${await listenFakeAcmeServer(server)}/directory`;
    const accountKey = generateRsaKeyPair(2048);
    const realFetch = fetch;
    let firstAttempt = true;

    const patchedFetch = async (input, init) => {
      if (init?.method === 'POST' && firstAttempt && String(input).includes('/new-account')) {
        firstAttempt = false;
        const body = JSON.parse(init.body);
        body.protected = Buffer.from(
          JSON.stringify({
            ...JSON.parse(Buffer.from(body.protected, 'base64url').toString('utf8')),
            nonce: 'stale-nonce-not-issued-by-server',
          }),
          'utf8',
        ).toString('base64url');
        return realFetch(input, { ...init, body: JSON.stringify(body) });
      }
      return realFetch(input, init);
    };

    const patchedClient = createAcmeClient({ directoryUrl, accountKey, fetchImpl: patchedFetch });
    const { kid } = await patchedClient.createAccount();
    assert.match(kid, /\/acct\//);
    assert.equal(firstAttempt, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('acmeError carries the HTTP status and response data for callers to branch on', () => {
  const error = acmeError(400, { type: 'urn:ietf:params:acme:error:malformed', detail: 'bad request' });
  assert.equal(error.status, 400);
  assert.match(error.message, /bad request/);
  assert.equal(error.data.type, 'urn:ietf:params:acme:error:malformed');
});

test('createOrder rejects (via signedRequest error surfacing) when the server 400s', async () => {
  let base;
  const server = createServer((req, res) => {
    if (req.url === '/directory') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ newNonce: `${base}/nn`, newAccount: `${base}/na`, newOrder: `${base}/no` }));
      return;
    }
    res.writeHead(400, { 'content-type': 'application/json', 'replay-nonce': 'n' });
    res.end(JSON.stringify({ type: 'urn:ietf:params:acme:error:malformed', detail: 'nope' }));
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        base = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
    const accountKey = generateEcKeyPair('P-256');
    const client = createAcmeClient({ directoryUrl: `${base}/directory`, accountKey });
    await assert.rejects(() => client.createAccount(), /nope/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
