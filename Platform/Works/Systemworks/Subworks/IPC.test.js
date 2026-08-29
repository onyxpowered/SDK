// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createRawServer, createConnection } from 'node:net';
import { startIpcServer, sendIpcRequest } from './IPC.js';

async function withTempSocketDir(run) {
  const dir = await mkdtemp(join(tmpdir(), 'ship-ipc-test-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('IPC: a CLI-style request round-trips through the daemon socket', async () => {
  await withTempSocketDir(async (dir) => {
    const socketPath = join(dir, 'daemon.sock');
    const server = await startIpcServer(socketPath, async (message) => {
      if (message.type === 'echo') {
        return { echoed: message.payload };
      }
      throw new Error(`unknown type: ${message.type}`);
    });
    try {
      const result = await sendIpcRequest(socketPath, { type: 'echo', payload: 'hello daemon' });
      assert.deepEqual(result, { echoed: 'hello daemon' });
    } finally {
      server.close();
    }
  });
});

test('IPC: server-side handler errors surface as a rejected client promise', async () => {
  await withTempSocketDir(async (dir) => {
    const socketPath = join(dir, 'daemon.sock');
    const server = await startIpcServer(socketPath, async () => {
      throw new Error('boom');
    });
    try {
      await assert.rejects(() => sendIpcRequest(socketPath, { type: 'anything' }), /boom/);
    } finally {
      server.close();
    }
  });
});

test('IPC: client rejects immediately when nothing is listening at the socket path (ENOENT, not a timeout)', async () => {
  await withTempSocketDir(async (dir) => {
    const socketPath = join(dir, 'nothing-here.sock');
    const start = Date.now();
    await assert.rejects(() => sendIpcRequest(socketPath, { type: 'version' }, 5000));
    assert.ok(Date.now() - start < 1000);
  });
});

test('IPC: client actually times out via the timer when the server accepts but never responds', async () => {
  await withTempSocketDir(async (dir) => {
    const socketPath = join(dir, 'silent.sock');
    const rawServer = createRawServer((socket) => {
      socket.on('data', () => {});
    });
    await new Promise((resolve, reject) => {
      rawServer.once('error', reject);
      rawServer.listen(socketPath, resolve);
    });
    try {
      const start = Date.now();
      await assert.rejects(() => sendIpcRequest(socketPath, { type: 'version' }, 300), /timed out/);
      assert.ok(Date.now() - start >= 280);
    } finally {
      rawServer.close();
    }
  });
});

test('IPC: a non-JSON line does not crash the server and does not wedge the connection', async () => {
  await withTempSocketDir(async (dir) => {
    const socketPath = join(dir, 'daemon.sock');
    const server = await startIpcServer(socketPath, async () => ({ ok: true }));
    try {
      await new Promise((resolve, reject) => {
        const raw = createConnection(socketPath);
        raw.once('connect', () => {
          raw.write('this is not json at all\n');
          setTimeout(() => {
            raw.end();
            resolve();
          }, 50);
        });
        raw.once('error', reject);
      });

      const result = await sendIpcRequest(socketPath, { type: 'anything' });
      assert.deepEqual(result, { ok: true });
    } finally {
      server.close();
    }
  });
});

test('IPC: a syntactically valid message missing "type" surfaces a clear handler error, not a hang', async () => {
  await withTempSocketDir(async (dir) => {
    const socketPath = join(dir, 'daemon.sock');
    const server = await startIpcServer(socketPath, async (message) => {
      if (!message.type) {
        throw new Error('message.type is required');
      }
      return { ok: true };
    });
    try {
      await assert.rejects(() => sendIpcRequest(socketPath, {}), /message\.type is required/);
    } finally {
      server.close();
    }
  });
});

test('IPC: a partial write with no trailing newline followed by socket close does not leak the connection', async () => {
  await withTempSocketDir(async (dir) => {
    const socketPath = join(dir, 'daemon.sock');
    const server = await startIpcServer(socketPath, async () => ({ ok: true }));
    try {
      await new Promise((resolve, reject) => {
        const raw = createConnection(socketPath);
        raw.once('connect', () => {
          raw.write('{"type":"incomple');
          setTimeout(() => {
            raw.destroy();
            resolve();
          }, 50);
        });
        raw.once('error', reject);
      });

      const result = await sendIpcRequest(socketPath, { type: 'anything' });
      assert.deepEqual(result, { ok: true });
    } finally {
      server.close();
    }
  });
});

test('IPC: a multi-byte UTF-8 character split across two socket chunks decodes correctly, not as replacement-character garbage', async () => {
  await withTempSocketDir(async (dir) => {
    const socketPath = join(dir, 'daemon.sock');
    let receivedPayload = null;
    const server = await startIpcServer(socketPath, async (message) => {
      receivedPayload = message.payload;
      return { ok: true };
    });
    try {
      const line = `${JSON.stringify({ type: 'echo', payload: 'hello \u{1F600} world', id: 'split-test' })}\n`;
      const fullBuffer = Buffer.from(line, 'utf8');
      const emojiIndex = fullBuffer.indexOf(Buffer.from('\u{1F600}', 'utf8'));
      const splitPoint = emojiIndex + 2;

      await new Promise((resolve, reject) => {
        const raw = createConnection(socketPath);
        const timer = setTimeout(() => reject(new Error('timed out waiting for a response')), 2000);
        raw.once('connect', () => {
          raw.write(fullBuffer.subarray(0, splitPoint));
          setTimeout(() => {
            raw.write(fullBuffer.subarray(splitPoint));
          }, 30);
        });
        raw.once('data', () => {
          clearTimeout(timer);
          raw.end();
          resolve();
        });
        raw.once('error', reject);
      });

      assert.equal(receivedPayload, 'hello \u{1F600} world');
    } finally {
      server.close();
    }
  });
});
