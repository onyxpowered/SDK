// SDK
// Designed & Built By onyxpowered.

import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { streamProxyRequest, streamProxyUpgrade } from './Proxy.js';
import { attemptPortForward } from './PortForward.js';
import { validateBlockHandle, blockOrigin } from '../Block.js';
import { issueCertificate } from '../Vendors/AcmeClient/Index.js';
import { exportPrivateKeyPem } from '../Crypto/Keys.js';

export const LETS_ENCRYPT_DIRECTORY_URL = 'https://acme-v02.api.letsencrypt.org/directory';
const HTTP01_CHALLENGE_PATH_PREFIX = '/.well-known/acme-challenge/';

export function createHttp01ChallengeServer() {
  const tokens = new Map();

  const server = createHttpServer((req, res) => {
    if (!req.url.startsWith(HTTP01_CHALLENGE_PATH_PREFIX)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const token = req.url.slice(HTTP01_CHALLENGE_PATH_PREFIX.length);
    const keyAuthorization = tokens.get(token);
    if (!keyAuthorization) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(keyAuthorization);
  });

  return Object.freeze({
    server,
    setToken: (token, keyAuthorization) => tokens.set(token, keyAuthorization),
    clearToken: (token) => tokens.delete(token),
    listen: (port = 80, hostname = '0.0.0.0') => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, hostname, () => {
        server.removeListener('error', reject);
        resolve(server.address());
      });
    }),
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  });
}

export async function issueProductionCertificate({
  domain,
  altNames = [domain],
  accountKey,
  leafKey,
  directoryUrl = LETS_ENCRYPT_DIRECTORY_URL,
  contact = [],
  existingKid = null,
  challengeServerPort = 80,
  challengeServerHost = '0.0.0.0',
  challengeServerFactory = createHttp01ChallengeServer,
  pollOptions,
  fetchImpl,
}) {
  const challengeServer = challengeServerFactory();
  await challengeServer.listen(challengeServerPort, challengeServerHost);
  try {
    return await issueCertificate({
      directoryUrl,
      accountKey,
      altNames,
      commonName: domain,
      leafKey,
      contact,
      existingKid,
      pollOptions,
      fetchImpl,
      fulfillChallenge: async (challenge, keyAuthorization) => {
        challengeServer.setToken(challenge.token, keyAuthorization);
      },
      removeChallenge: async (challenge) => {
        challengeServer.clearToken(challenge.token);
      },
    });
  } finally {
    await challengeServer.close();
  }
}

export function createProductionServer({ certificatePem, privateKeyPem, blockHandle }) {
  validateBlockHandle(blockHandle);

  const server = createHttpsServer(
    { key: privateKeyPem, cert: certificatePem },
    (req, res) => streamProxyRequest(req, res, blockHandle),
  );
  server.on('upgrade', (req, socket, head) => streamProxyUpgrade(req, socket, head, blockHandle));
  return server;
}

export async function startProductionServer({ certificatePem, privateKeyPem, blockHandle, port = 443, hostname = '0.0.0.0' }) {
  const server = createProductionServer({ certificatePem, privateKeyPem, blockHandle });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, hostname, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  return Object.freeze({
    server,
    port: address.port,
    hostname,
    upstream: blockOrigin(blockHandle),
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  });
}

export async function bootstrapProductionRouting({
  domain,
  altNames,
  accountKey,
  leafKey,
  blockHandle,
  contact = [],
  directoryUrl = LETS_ENCRYPT_DIRECTORY_URL,
  httpsPort = 443,
  challengePort = 80,
  attemptForwarding = true,
  portForwardOptions = {},
  challengeServerFactory,
  pollOptions,
  fetchImpl,
}) {
  validateBlockHandle(blockHandle);

  let portForwardResults = null;
  if (attemptForwarding) {
    portForwardResults = {
      https: await attemptPortForward(httpsPort, portForwardOptions),
      challenge: await attemptPortForward(challengePort, portForwardOptions),
    };
  }

  const { certificateChainPem, kid } = await issueProductionCertificate({
    domain,
    altNames: altNames ?? [domain],
    accountKey,
    leafKey,
    directoryUrl,
    contact,
    challengeServerPort: challengePort,
    challengeServerFactory,
    pollOptions,
    fetchImpl,
  });

  const running = await startProductionServer({
    certificatePem: certificateChainPem,
    privateKeyPem: exportPrivateKeyPem(leafKey.privateKey),
    blockHandle,
    port: httpsPort,
  });

  return Object.freeze({ ...running, kid, certificateChainPem, portForwardResults });
}
