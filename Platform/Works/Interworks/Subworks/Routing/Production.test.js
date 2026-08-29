// SDK
// Designed & Built By onyxpowered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { generateRsaKeyPair } from '../Crypto/Keys.js';
import { parseCertificate } from '../Crypto/X509.js';
import { createStaticBlockHandle } from '../Block.js';
import { makeFakeAcmeCa, startFakeAcmeServer, listenFakeAcmeServer } from '../Vendors/AcmeClient/__fixtures__/FakeAcmeServer.js';
import {
  createHttp01ChallengeServer,
  issueProductionCertificate,
  startProductionServer,
  bootstrapProductionRouting,
  LETS_ENCRYPT_DIRECTORY_URL,
} from './Production.js';

function requestJson(url, caCertPem, extraOptions = {}) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { ca: caCertPem, ...extraOptions }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

function listenHttp(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
  });
}

test('LETS_ENCRYPT_DIRECTORY_URL points at the real production ACME v2 directory', () => {
  assert.equal(LETS_ENCRYPT_DIRECTORY_URL, 'https://acme-v02.api.letsencrypt.org/directory');
});

test('createHttp01ChallengeServer serves the exact key authorization at the well-known path once set', async () => {
  const challengeServer = createHttp01ChallengeServer();
  try {
    const { port } = await challengeServer.listen(0, '127.0.0.1');
    challengeServer.setToken('tok-abc', 'tok-abc.thumbprint123');

    const response = await fetch(`http://127.0.0.1:${port}/.well-known/acme-challenge/tok-abc`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'tok-abc.thumbprint123');
  } finally {
    await challengeServer.close();
  }
});

test('createHttp01ChallengeServer returns 404 for an unknown token and for unrelated paths', async () => {
  const challengeServer = createHttp01ChallengeServer();
  try {
    const { port } = await challengeServer.listen(0, '127.0.0.1');

    const unknownToken = await fetch(`http://127.0.0.1:${port}/.well-known/acme-challenge/never-set`);
    assert.equal(unknownToken.status, 404);

    const unrelatedPath = await fetch(`http://127.0.0.1:${port}/some-other-path`);
    assert.equal(unrelatedPath.status, 404);
  } finally {
    await challengeServer.close();
  }
});

test('createHttp01ChallengeServer stops serving a token after clearToken', async () => {
  const challengeServer = createHttp01ChallengeServer();
  try {
    const { port } = await challengeServer.listen(0, '127.0.0.1');
    challengeServer.setToken('tok-xyz', 'tok-xyz.thumb');
    challengeServer.clearToken('tok-xyz');

    const response = await fetch(`http://127.0.0.1:${port}/.well-known/acme-challenge/tok-xyz`);
    assert.equal(response.status, 404);
  } finally {
    await challengeServer.close();
  }
});

function spyingChallengeServerFactory(selfFetchResults) {
  return () => {
    const inner = createHttp01ChallengeServer();
    return {
      ...inner,
      setToken: async (token, keyAuthorization) => {
        inner.setToken(token, keyAuthorization);
        const address = inner.server.address();
        const response = await fetch(`http://127.0.0.1:${address.port}/.well-known/acme-challenge/${token}`);
        const body = await response.text();
        selfFetchResults.push({ token, keyAuthorization, servedStatus: response.status, servedBody: body });
      },
    };
  };
}

test('issueProductionCertificate actually serves the correct key authorization over real HTTP during issuance, then issues a valid cert', async () => {
  const ca = await makeFakeAcmeCa();
  const { server } = startFakeAcmeServer({ ca });
  try {
    const directoryUrl = `${await listenFakeAcmeServer(server)}/directory`;
    const accountKey = generateRsaKeyPair(2048);
    const leafKey = generateRsaKeyPair(2048);
    const selfFetchResults = [];

    const result = await issueProductionCertificate({
      domain: 'prod-check.local',
      accountKey,
      leafKey,
      directoryUrl,
      challengeServerPort: 0,
      challengeServerHost: '127.0.0.1',
      challengeServerFactory: spyingChallengeServerFactory(selfFetchResults),
      pollOptions: { intervalMs: 5, timeoutMs: 2000 },
    });

    assert.equal(selfFetchResults.length, 1);
    assert.equal(selfFetchResults[0].servedStatus, 200);
    assert.equal(selfFetchResults[0].servedBody, selfFetchResults[0].keyAuthorization);

    assert.match(result.kid, /\/acct\//);
    const cert = parseCertificate(result.certificateChainPem);
    assert.match(cert.subject, /CN=prod-check\.local/);
    assert.equal(cert.checkPrivateKey(leafKey.privateKey), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('issueProductionCertificate always closes the challenge server, even when issuance fails', async () => {
  let closed = false;
  const challengeServerFactory = () => {
    const inner = createHttp01ChallengeServer();
    return {
      ...inner,
      close: async () => {
        closed = true;
        await inner.close();
      },
    };
  };

  await assert.rejects(() => issueProductionCertificate({
    domain: 'will-fail.local',
    accountKey: generateRsaKeyPair(2048),
    leafKey: generateRsaKeyPair(2048),
    directoryUrl: 'http://127.0.0.1:1/directory',
    challengeServerPort: 0,
    challengeServerHost: '127.0.0.1',
    challengeServerFactory,
  }));

  assert.equal(closed, true);
});

async function makeSelfSignedServerCert(altNames) {
  const { buildName, buildCertificate } = await import('../Crypto/X509.js');
  const { exportPrivateKeyPem } = await import('../Crypto/Keys.js');
  const { privateKey, publicKey } = generateRsaKeyPair(2048);
  const name = buildName({ CN: altNames[0] });
  const certificatePem = buildCertificate({
    subjectPublicKey: publicKey,
    subjectName: name,
    issuerName: name,
    issuerPrivateKey: privateKey,
    altNames,
  });
  return { certificatePem, privateKeyPem: exportPrivateKeyPem(privateKey) };
}

test('startProductionServer terminates real HTTPS and proxies to the Block handle', async () => {
  const upstream = createHttpServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`production says: ${req.url}`);
  });
  let production;
  try {
    const { port: upstreamPort } = await listenHttp(upstream);
    const { certificatePem, privateKeyPem } = await makeSelfSignedServerCert(['production-test.local', '127.0.0.1']);
    const blockHandle = createStaticBlockHandle({ host: '127.0.0.1', port: upstreamPort });

    production = await startProductionServer({ certificatePem, privateKeyPem, blockHandle, port: 0, hostname: '127.0.0.1' });
    assert.equal(production.upstream, `http://127.0.0.1:${upstreamPort}`);

    const response = await requestJson(`https://127.0.0.1:${production.port}/hi`, certificatePem);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body, 'production says: /hi');
  } finally {
    await production?.close();
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test('bootstrapProductionRouting composes issuance + server startup end to end (no port forwarding attempted)', async () => {
  const ca = await makeFakeAcmeCa();
  const { server } = startFakeAcmeServer({ ca });
  const upstream = createHttpServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`block says: ${req.url}`);
  });
  let running;
  try {
    const directoryUrl = `${await listenFakeAcmeServer(server)}/directory`;
    const { port: upstreamPort } = await listenHttp(upstream);
    const blockHandle = createStaticBlockHandle({ host: '127.0.0.1', port: upstreamPort });

    running = await bootstrapProductionRouting({
      domain: 'bootstrap-check.local',
      accountKey: generateRsaKeyPair(2048),
      leafKey: generateRsaKeyPair(2048),
      blockHandle,
      directoryUrl,
      httpsPort: 0,
      challengePort: 0,
      attemptForwarding: false,
      pollOptions: { intervalMs: 5, timeoutMs: 2000 },
    });

    assert.equal(running.portForwardResults, null);
    assert.match(running.kid, /\/acct\//);

    const cert = parseCertificate(running.certificateChainPem);
    assert.match(cert.subject, /CN=bootstrap-check\.local/);

    const response = await requestJson(`https://127.0.0.1:${running.port}/x`, running.certificateChainPem, {
      servername: 'bootstrap-check.local',
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body, 'block says: /x');
  } finally {
    await running?.close();
    await new Promise((resolve) => upstream.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  }
});
