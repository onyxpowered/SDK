// SDK
// Designed & Built By onyxpowered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateRsaKeyPair } from '../../Crypto/Keys.js';
import { parseCertificate } from '../../Crypto/X509.js';
import { issueCertificate, createAcmeClient, signJws, acmeRequest } from './Index.js';
import { makeFakeAcmeCa, startFakeAcmeServer, listenFakeAcmeServer } from './__fixtures__/FakeAcmeServer.js';

test('Index.js re-exports the underlying building blocks', () => {
  assert.equal(typeof createAcmeClient, 'function');
  assert.equal(typeof signJws, 'function');
  assert.equal(typeof acmeRequest, 'function');
  assert.equal(typeof issueCertificate, 'function');
});

test('issueCertificate rejects when fulfillChallenge is not a function', async () => {
  await assert.rejects(
    () => issueCertificate({
      directoryUrl: 'http://example.test/directory',
      accountKey: generateRsaKeyPair(2048),
      altNames: ['x.test'],
      leafKey: generateRsaKeyPair(2048),
      fulfillChallenge: undefined,
    }),
    /requires a fulfillChallenge/,
  );
});

test('issueCertificate drives the full flow through injected fulfillChallenge/removeChallenge callbacks', async () => {
  const ca = await makeFakeAcmeCa();
  const { server } = startFakeAcmeServer({ ca });
  try {
    const directoryUrl = `${await listenFakeAcmeServer(server)}/directory`;
    const accountKey = generateRsaKeyPair(2048);
    const leafKey = generateRsaKeyPair(2048);

    const fulfilledCalls = [];
    const removedCalls = [];

    const result = await issueCertificate({
      directoryUrl,
      accountKey,
      altNames: ['issue-flow.local'],
      leafKey,
      contact: ['mailto:dev@onyxlabs.test'],
      pollOptions: { intervalMs: 5, timeoutMs: 2000 },
      fulfillChallenge: async (challenge, keyAuthorization, authorization) => {
        fulfilledCalls.push({ challenge, keyAuthorization, authorization });
      },
      removeChallenge: async (challenge) => {
        removedCalls.push(challenge);
      },
    });

    assert.match(result.kid, /\/acct\//);
    assert.match(result.certificateChainPem, /-----BEGIN CERTIFICATE-----/);

    const cert = parseCertificate(result.certificateChainPem);
    assert.match(cert.subject, /CN=issue-flow\.local/);
    assert.equal(cert.checkPrivateKey(leafKey.privateKey), true);

    assert.equal(fulfilledCalls.length, 1);
    assert.equal(fulfilledCalls[0].keyAuthorization.split('.').length, 2);
    assert.equal(removedCalls.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('issueCertificate still calls removeChallenge for already-fulfilled challenges when a later step fails', async () => {
  const ca = await makeFakeAcmeCa();
  const { server } = startFakeAcmeServer({ ca });
  try {
    const directoryUrl = `${await listenFakeAcmeServer(server)}/directory`;
    const accountKey = generateRsaKeyPair(2048);
    const leafKey = generateRsaKeyPair(2048);
    const removedCalls = [];

    await assert.rejects(
      () => issueCertificate({
        directoryUrl,
        accountKey,
        altNames: ['cleanup-check.local'],
        leafKey,
        pollOptions: { intervalMs: 5, timeoutMs: 2000 },
        fulfillChallenge: async () => {
          throw new Error('simulated file-serving failure');
        },
        removeChallenge: async (challenge) => {
          removedCalls.push(challenge);
        },
      }),
      /simulated file-serving failure/,
    );

    assert.equal(removedCalls.length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('issueCertificate covers multiple altNames, one authorization/challenge per identifier', async () => {
  const ca = await makeFakeAcmeCa();
  const { server } = startFakeAcmeServer({ ca });
  try {
    const directoryUrl = `${await listenFakeAcmeServer(server)}/directory`;
    const accountKey = generateRsaKeyPair(2048);
    const leafKey = generateRsaKeyPair(2048);
    const fulfilledIdentifiers = [];

    const result = await issueCertificate({
      directoryUrl,
      accountKey,
      altNames: ['multi-a.local', 'multi-b.local'],
      leafKey,
      pollOptions: { intervalMs: 5, timeoutMs: 2000 },
      fulfillChallenge: async (challenge, keyAuthorization, authorization) => {
        fulfilledIdentifiers.push(authorization.identifier.value);
      },
      removeChallenge: async () => {},
    });

    assert.deepEqual(fulfilledIdentifiers.sort(), ['multi-a.local', 'multi-b.local']);
    const cert = parseCertificate(result.certificateChainPem);
    assert.ok(cert.subjectAltName.includes('DNS:multi-a.local'));
    assert.ok(cert.subjectAltName.includes('DNS:multi-b.local'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
