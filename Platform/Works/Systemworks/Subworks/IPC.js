// SDK
// Designed & Built By onyxpowered.

import { createServer, createConnection } from 'node:net';
import { existsSync, unlinkSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';

function frameMessage(message) {
  return `${JSON.stringify(message)}\n`;
}

function createLineReader(socket, onMessage) {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  socket.on('data', (chunk) => {
    buffer += decoder.write(chunk);
    let index = buffer.indexOf('\n');
    while (index !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.length > 0) {
        try {
          onMessage(JSON.parse(line));
        } catch {}
      }
      index = buffer.indexOf('\n');
    }
  });
}

export function startIpcServer(socketPath, requestHandler) {
  if (process.platform !== 'win32' && existsSync(socketPath)) {
    unlinkSync(socketPath);
  }
  const server = createServer((socket) => {
    createLineReader(socket, async (message) => {
      let response;
      try {
        const result = await requestHandler(message);
        response = { id: message.id, ok: true, result };
      } catch (error) {
        response = { id: message.id, ok: false, error: error.message };
      }
      socket.end(frameMessage(response));
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.removeListener('error', reject);
      resolve(server);
    });
  });
}

let requestCounter = 0;

export function sendIpcRequest(socketPath, request, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const id = `${process.pid}-${Date.now()}-${requestCounter++}`;
    const socket = createConnection(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('IPC request timed out'));
    }, timeoutMs);

    socket.once('connect', () => {
      socket.write(frameMessage({ ...request, id }));
    });

    createLineReader(socket, (message) => {
      if (message.id !== id) return;
      clearTimeout(timer);
      socket.destroy();
      if (message.ok) {
        resolve(message.result);
      } else {
        reject(new Error(message.error));
      }
    });

    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
