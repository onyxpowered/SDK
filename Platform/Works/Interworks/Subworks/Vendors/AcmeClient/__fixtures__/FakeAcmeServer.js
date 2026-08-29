// SDK
// Designed & Built By onyxpowered.

import { createServer } from 'node:http';
import { createPublicKey, verify as cryptoVerify, randomUUID } from 'node:crypto';
import { generateRsaKeyPair } from '../../../Crypto/Keys.js';
import { buildName, buildCertificate, extractSubjectNameDer } from '../../../Crypto/X509.js';
import { decodeSequence } from '../../../Crypto/Der.js';
import { jwkThumbprint } from '../../../Crypto/Keys.js';

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function verifyOptionsForAlg(alg, key) {
  if (alg === 'RS256') return key;
  if (alg === 'ES256' || alg === 'ES384' || alg === 'ES512') return { key, dsaEncoding: 'ieee-p1363' };
  throw new Error(`unsupported alg in fake ACME server: ${alg}`);
}

function hashForAlg(alg) {
  if (alg === 'RS256' || alg === 'ES256') return 'sha256';
  if (alg === 'ES384') return 'sha384';
  if (alg === 'ES512') return 'sha512';
  throw new Error(`unsupported alg in fake ACME server: ${alg}`);
}

function encodeDerLength(length) {
  if (length < 0x80) return Buffer.from([length]);
  const bytes = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining = Math.floor(remaining / 256);
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

export function extractCsrPublicKeyDer(csrDer) {
  const [certificationRequestInfoItem] = decodeSequence(csrDer);
  const infoDer = Buffer.concat([
    Buffer.from([certificationRequestInfoItem.tag]),
    encodeDerLength(certificationRequestInfoItem.content.length),
    certificationRequestInfoItem.content,
  ]);
  const infoItems = decodeSequence(infoDer);
  const subjectPkInfo = infoItems[2];
  return Buffer.concat([Buffer.from([subjectPkInfo.tag]), encodeDerLength(subjectPkInfo.content.length), subjectPkInfo.content]);
}

export async function makeFakeAcmeCa() {
  const { privateKey, publicKey } = generateRsaKeyPair(2048);
  const name = buildName({ CN: 'Fake ACME Test CA' });
  const certificatePem = buildCertificate({
    subjectPublicKey: publicKey,
    subjectName: name,
    issuerName: name,
    issuerPrivateKey: privateKey,
    isCA: true,
  });
  return { privateKey, publicKey, certificatePem };
}

export function startFakeAcmeServer({ ca, autoValidateChallenges = true, processingPollsBeforeValid = 2 }) {
  const nonces = new Set();
  const accountsByThumbprint = new Map();
  const accountsByKid = new Map();
  const orders = new Map();
  const authorizations = new Map();
  const finalizeCsrs = [];

  function base(req) {
    return `http://${req.headers.host}`;
  }

  function issueNonce(res) {
    const nonce = randomUUID();
    nonces.add(nonce);
    res.setHeader('replay-nonce', nonce);
  }

  async function verifyAndParse(req) {
    const raw = await readBody(req);
    const body = raw.length > 0 ? JSON.parse(raw) : {};
    const header = JSON.parse(Buffer.from(body.protected, 'base64url').toString('utf8'));

    if (!nonces.has(header.nonce)) {
      const error = new Error('badNonce');
      error.acmeType = 'urn:ietf:params:acme:error:badNonce';
      throw error;
    }
    nonces.delete(header.nonce);

    const jwk = header.jwk ?? accountsByKid.get(header.kid)?.jwk;
    const publicKey = createPublicKey({ key: jwk, format: 'jwk' });
    const signingInput = Buffer.from(`${body.protected}.${body.payload}`);
    const ok = cryptoVerify(hashForAlg(header.alg), signingInput, verifyOptionsForAlg(header.alg, publicKey), Buffer.from(body.signature, 'base64url'));
    if (!ok) {
      throw new Error('invalid JWS signature');
    }

    const payload = body.payload.length > 0 ? JSON.parse(Buffer.from(body.payload, 'base64url').toString('utf8')) : null;
    return { header, payload, jwk };
  }

  function sendJson(res, status, data, headers = {}) {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(data));
  }

  const server = createServer(async (req, res) => {
    issueNonce(res);
    const url = new URL(req.url, `http://${req.headers.host}`);

    try {
      if (req.method === 'GET' && url.pathname === '/directory') {
        sendJson(res, 200, {
          newNonce: `${base(req)}/new-nonce`,
          newAccount: `${base(req)}/new-account`,
          newOrder: `${base(req)}/new-order`,
        });
        return;
      }

      if (req.method === 'HEAD' && url.pathname === '/new-nonce') {
        res.writeHead(200);
        res.end();
        return;
      }

      if (req.method === 'POST' && url.pathname === '/new-account') {
        const { payload, jwk } = await verifyAndParse(req);
        const thumbprint = jwkThumbprint(jwk);
        let account = accountsByThumbprint.get(thumbprint);
        if (!account) {
          const id = randomUUID();
          const kid = `${base(req)}/acct/${id}`;
          account = { id, kid, jwk, payload };
          accountsByThumbprint.set(thumbprint, account);
          accountsByKid.set(kid, account);
        }
        sendJson(res, 201, { status: 'valid' }, { location: account.kid });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/new-order') {
        const { payload } = await verifyAndParse(req);
        const orderId = randomUUID();
        const authzEntries = payload.identifiers.map((identifier) => {
          const authzId = randomUUID();
          const authz = {
            id: authzId,
            status: 'pending',
            identifier,
            challengeToken: randomUUID(),
            challengeStatus: 'pending',
          };
          authorizations.set(authzId, authz);
          return authz;
        });
        const order = {
          id: orderId,
          status: 'pending',
          identifiers: payload.identifiers,
          authorizationIds: authzEntries.map((a) => a.id),
          authorizationUrls: authzEntries.map((a) => `${base(req)}/authz/${a.id}`),
          finalizeUrl: `${base(req)}/finalize/${orderId}`,
          processingPollCount: 0,
        };
        orders.set(orderId, order);
        sendJson(
          res,
          201,
          {
            status: order.status,
            identifiers: order.identifiers,
            authorizations: order.authorizationUrls,
            finalize: order.finalizeUrl,
          },
          { location: `${base(req)}/order/${orderId}` },
        );
        return;
      }

      const authzMatch = url.pathname.match(/^\/authz\/([^/]+)$/);
      if (req.method === 'POST' && authzMatch) {
        await verifyAndParse(req);
        const authz = authorizations.get(authzMatch[1]);
        sendJson(res, 200, {
          status: authz.status,
          identifier: authz.identifier,
          challenges: [
            {
              type: 'http-01',
              url: `${base(req)}/challenge/${authz.id}`,
              token: authz.challengeToken,
              status: authz.challengeStatus,
            },
          ],
        });
        return;
      }

      const challengeMatch = url.pathname.match(/^\/challenge\/([^/]+)$/);
      if (req.method === 'POST' && challengeMatch) {
        await verifyAndParse(req);
        const authz = authorizations.get(challengeMatch[1]);
        if (autoValidateChallenges) {
          authz.challengeStatus = 'valid';
          authz.status = 'valid';
        } else {
          authz.challengeStatus = 'processing';
        }
        sendJson(res, 200, { type: 'http-01', status: authz.challengeStatus, token: authz.challengeToken });
        return;
      }

      const orderMatch = url.pathname.match(/^\/order\/([^/]+)$/);
      if (req.method === 'POST' && orderMatch) {
        await verifyAndParse(req);
        const order = orders.get(orderMatch[1]);

        const allAuthzValid = order.authorizationIds.every((id) => authorizations.get(id).status === 'valid');
        if (order.status === 'pending' && allAuthzValid) {
          order.status = 'ready';
        }

        if (order.status === 'processing') {
          order.processingPollCount += 1;
          if (order.processingPollCount >= processingPollsBeforeValid) {
            order.status = 'valid';
          }
        }

        sendJson(res, 200, {
          status: order.status,
          identifiers: order.identifiers,
          authorizations: order.authorizationUrls,
          finalize: order.finalizeUrl,
          certificate: order.status === 'valid' ? `${base(req)}/cert/${order.id}` : undefined,
        });
        return;
      }

      const finalizeMatch = url.pathname.match(/^\/finalize\/([^/]+)$/);
      if (req.method === 'POST' && finalizeMatch) {
        const { payload } = await verifyAndParse(req);
        const order = orders.get(finalizeMatch[1]);
        order.status = 'processing';
        finalizeCsrs.push(Buffer.from(payload.csr, 'base64url'));
        sendJson(res, 200, { status: order.status, identifiers: order.identifiers });
        return;
      }

      const certMatch = url.pathname.match(/^\/cert\/([^/]+)$/);
      if (req.method === 'POST' && certMatch) {
        await verifyAndParse(req);
        const csrDer = finalizeCsrs[finalizeCsrs.length - 1];
        const leafPublicKeyDer = extractCsrPublicKeyDer(csrDer);
        const leafPublicKey = createPublicKey({ key: leafPublicKeyDer, format: 'der', type: 'spki' });
        const [, order] = [...orders.entries()].find(([, candidate]) => `${base(req)}/cert/${candidate.id}` === url.href.replace(url.search, ''));
        const leafName = buildName({ CN: order?.identifiers?.[0]?.value ?? 'ship-acme-test.local' });
        const leafCertPem = buildCertificate({
          subjectPublicKey: leafPublicKey,
          subjectName: leafName,
          issuerName: extractSubjectNameDer(ca.certificatePem),
          issuerPrivateKey: ca.privateKey,
          altNames: (order?.identifiers ?? []).map((identifier) => identifier.value),
        });
        res.writeHead(200, { 'content-type': 'application/pem-certificate-chain' });
        res.end(`${leafCertPem}${ca.certificatePem}`);
        return;
      }

      sendJson(res, 404, { error: 'not found' });
    } catch (error) {
      const type = error.acmeType ?? 'urn:ietf:params:acme:error:malformed';
      sendJson(res, 400, { type, detail: error.message });
    }
  });

  return { server, orders, authorizations, finalizeCsrs };
}

export function listenFakeAcmeServer(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}
