// SDK
// Designed & Built By onyxpowered.

import { request as httpRequest } from 'node:http';
import { connect as netConnect } from 'node:net';
import { validateBlockHandle } from '../Block.js';

const BAD_GATEWAY_BODY = 'Ship: the Block behind this route is not reachable.';

export function streamProxyRequest(req, res, blockHandle) {
  validateBlockHandle(blockHandle);

  const upstream = httpRequest(
    {
      host: blockHandle.host,
      port: blockHandle.port,
      method: req.method,
      path: req.url,
      headers: req.headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode, upstreamRes.statusMessage, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );

  upstream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain' });
    }
    res.end(BAD_GATEWAY_BODY);
  });

  req.pipe(upstream);
}

export function streamProxyUpgrade(req, clientSocket, head, blockHandle) {
  validateBlockHandle(blockHandle);

  const upstreamSocket = netConnect(blockHandle.port, blockHandle.host, () => {
    const headerLines = Object.entries(req.headers).map(([key, value]) => `${key}: ${value}`);
    const requestLine = `${req.method} ${req.url} HTTP/1.1`;
    upstreamSocket.write(`${[requestLine, ...headerLines].join('\r\n')}\r\n\r\n`);
    if (head && head.length > 0) {
      upstreamSocket.write(head);
    }
    upstreamSocket.pipe(clientSocket);
    clientSocket.pipe(upstreamSocket);
  });

  upstreamSocket.on('error', () => {
    clientSocket.end();
  });
  clientSocket.on('error', () => {
    upstreamSocket.end();
  });
}

export async function bufferedProxyRequest(blockHandle, { method, url, headers = {}, body = null }) {
  validateBlockHandle(blockHandle);

  return new Promise((resolve, reject) => {
    const upstream = httpRequest(
      {
        host: blockHandle.host,
        port: blockHandle.port,
        method,
        path: url,
        headers,
      },
      (upstreamRes) => {
        const chunks = [];
        upstreamRes.on('data', (chunk) => chunks.push(chunk));
        upstreamRes.on('end', () => {
          resolve({
            statusCode: upstreamRes.statusCode,
            headers: upstreamRes.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );

    upstream.on('error', reject);
    if (body && body.length > 0) {
      upstream.write(body);
    }
    upstream.end();
  });
}

export function createBlockRequestHandler(blockHandle) {
  return async (request) => bufferedProxyRequest(blockHandle, request);
}
