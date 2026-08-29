// SDK
// Designed & Built By onyxpowered.
//
// A local stand-in for Preview -- the real preview.onyxpowered.com backend
// (login/signup, plus the WS tunnel host) -- so `sdk deploy preview` can be
// exercised fully offline, without that box needing to be up. Speaks the
// exact wire protocol Ship's real tunnel client already implements (see
// Platform/Works/Interworks/Subworks/Tunnel/Protocol.js and Client.js); this
// file adds nothing new to that protocol, it's the missing other half of it.
//
// Not a security boundary and not multi-tenant: any email/password is
// accepted as a fresh account, tokens are not persisted across restarts, and
// there is no rate limiting. It exists to make local development possible,
// not to imitate every property of the real service.

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import WebSocket from '../Platform/Works/Interworks/Subworks/Vendors/Ws/index.js';
import {
  MESSAGE_TYPES,
  encodeMessage,
  decodeMessage,
  decodeBody,
  createHelloAckMessage,
  createRequestMessage,
  createPongMessage,
} from '../Platform/Works/Interworks/Subworks/Tunnel/Protocol.js';

const DEFAULT_PORT = 4230;
const DEFAULT_PROXY_TIMEOUT_MS = 10000;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function handleAuth(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { error: 'malformed JSON body' });
  }
  if (!body.email || !body.password) {
    return sendJson(res, 400, { error: 'email and password are required' });
  }
  // A local mock has no real accounts to check a password against -- any
  // email/password combination succeeds, matching self-serve signup in spirit.
  return sendJson(res, 200, {
    accountId: `mock-${Buffer.from(body.email).toString('hex').slice(0, 12)}`,
    email: body.email,
    token: `mock-token-${randomUUID()}`,
  });
}

function previewPathFor(appSlug) {
  return `/${appSlug}`;
}

// Creates the mock server without starting it -- callers (the CLI entrypoint
// below, or a test) decide when/whether to listen.
export function createMockPreview({ port = DEFAULT_PORT, proxyTimeoutMs = DEFAULT_PROXY_TIMEOUT_MS } = {}) {
  // appSlug -> { ws, pending: Map<id, { resolve, timer }> }
  const sessions = new Map();
  let resolvedPort = port;

  function previewUrlFor(appSlug) {
    return `http://127.0.0.1:${resolvedPort}${previewPathFor(appSlug)}`;
  }

  async function proxyToApp(appSlug, req, res) {
    const session = sessions.get(appSlug);
    if (!session) {
      return sendJson(res, 502, { error: `no tunnel connected for "${appSlug}" -- is the app deployed via preview?` });
    }

    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const id = randomUUID();
    const innerUrl = req.url.slice(previewPathFor(appSlug).length) || '/';

    const responseMessage = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        session.pending.delete(id);
        reject(new Error('tunnel request timed out'));
      }, proxyTimeoutMs);
      session.pending.set(id, { resolve, timer });
      session.ws.send(
        encodeMessage(
          createRequestMessage({ id, method: req.method, url: innerUrl, headers: req.headers, body: body.length > 0 ? body : null }),
        ),
      );
    }).catch((error) => ({ type: MESSAGE_TYPES.ERROR, message: error.message }));

    if (responseMessage.type === MESSAGE_TYPES.ERROR) {
      return sendJson(res, 504, { error: responseMessage.message });
    }
    const responseBody = decodeBody(responseMessage);
    res.writeHead(responseMessage.statusCode, responseMessage.headers ?? {});
    res.end(responseBody);
  }

  const server = createServer((req, res) => {
    if (req.method === 'POST' && (req.url === '/api/login' || req.url === '/api/signup')) {
      handleAuth(req, res);
      return;
    }
    if (req.method === 'GET' && req.url === '/healthz') {
      sendJson(res, 200, { ok: true });
      return;
    }
    const appSlug = req.url.split('/').filter(Boolean)[0];
    if (!appSlug) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    proxyToApp(appSlug, req, res).catch((error) => sendJson(res, 500, { error: error.message }));
  });

  const wss = new WebSocket.WebSocketServer({ server });

  wss.on('connection', (ws) => {
    let appSlug = null;

    ws.on('message', (raw) => {
      let message;
      try {
        message = decodeMessage(raw);
      } catch {
        return;
      }

      if (message.type === MESSAGE_TYPES.HELLO) {
        appSlug = message.appSlug;
        sessions.set(appSlug, { ws, pending: new Map() });
        ws.send(encodeMessage(createHelloAckMessage({ previewUrl: previewUrlFor(appSlug), sessionId: randomUUID() })));
        return;
      }
      if (message.type === MESSAGE_TYPES.PING) {
        ws.send(encodeMessage(createPongMessage()));
        return;
      }
      if (message.type === MESSAGE_TYPES.RESPONSE || message.type === MESSAGE_TYPES.ERROR) {
        const session = appSlug && sessions.get(appSlug);
        const pending = session?.pending.get(message.id);
        if (!pending) return;
        session.pending.delete(message.id);
        clearTimeout(pending.timer);
        pending.resolve(message);
      }
    });

    ws.on('close', () => {
      if (appSlug && sessions.get(appSlug)?.ws === ws) {
        sessions.delete(appSlug);
      }
    });
  });

  return Object.freeze({
    server,
    listen: () =>
      new Promise((resolve) => {
        server.listen(port, '127.0.0.1', () => {
          resolvedPort = server.address().port;
          resolve({ port: resolvedPort, url: `http://127.0.0.1:${resolvedPort}` });
        });
      }),
    close: () =>
      new Promise((resolve) => {
        wss.close();
        server.close(resolve);
      }),
    connectedAppSlugs: () => [...sessions.keys()],
  });
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const portArg = process.argv.find((arg) => arg.startsWith('--port='));
  const port = portArg ? Number(portArg.slice('--port='.length)) : DEFAULT_PORT;
  const preview = createMockPreview({ port });
  preview.listen().then(({ url }) => {
    console.log(`mock Preview listening on ${url}`);
    console.log(`point the CLI at it with: SHIP_SERVICES_URL=${url} sdk login --signup`);
    console.log('ctrl+c to stop.');
  });
  process.on('SIGINT', () => preview.close().then(() => process.exit(0)));
  process.on('SIGTERM', () => preview.close().then(() => process.exit(0)));
}
