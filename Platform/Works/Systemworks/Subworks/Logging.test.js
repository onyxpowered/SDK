// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDaemonLogger, tailLog } from './Logging.js';

async function withTempLogFile(run) {
  const dir = await mkdtemp(join(tmpdir(), 'logging-test-'));
  try {
    await run(join(dir, 'daemon.log'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('createDaemonLogger: info/warn/error each append a JSON line with the right level', async () => {
  await withTempLogFile(async (logPath) => {
    const logger = createDaemonLogger(logPath);
    await logger.info('daemon starting', { version: '0.1.0' });
    await logger.warn('degraded telemetry', { channel: 'system' });
    await logger.error('composition failed', { error: 'boom' });

    const entries = await tailLog(logPath);
    assert.equal(entries.length, 3);
    assert.equal(entries[0].level, 'info');
    assert.equal(entries[0].message, 'daemon starting');
    assert.equal(entries[0].version, '0.1.0');
    assert.equal(entries[1].level, 'warn');
    assert.equal(entries[2].level, 'error');
  });
});

test('createDaemonLogger: creates the log directory on first write instead of requiring it to pre-exist', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logging-test-'));
  try {
    const nestedLogPath = join(dir, 'nested', 'deep', 'daemon.log');
    const logger = createDaemonLogger(nestedLogPath);
    await logger.info('hello');
    const entries = await tailLog(nestedLogPath);
    assert.equal(entries.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('createDaemonLogger: stamps every entry with an ISO timestamp', async () => {
  await withTempLogFile(async (logPath) => {
    const logger = createDaemonLogger(logPath);
    await logger.info('hello');
    const [entry] = await tailLog(logPath);
    assert.ok(!Number.isNaN(Date.parse(entry.timestamp)));
  });
});

test('tailLog: returns an empty array for a log file that does not exist yet', async () => {
  await withTempLogFile(async (logPath) => {
    assert.deepEqual(await tailLog(logPath), []);
  });
});

test('tailLog: respects lineCount, returning only the most recent entries', async () => {
  await withTempLogFile(async (logPath) => {
    const logger = createDaemonLogger(logPath);
    for (let i = 0; i < 5; i++) await logger.info(`entry ${i}`);
    const entries = await tailLog(logPath, 2);
    assert.deepEqual(entries.map((e) => e.message), ['entry 3', 'entry 4']);
  });
});

test('createDaemonLogger: verbose defaults to off -- nothing reaches stdout unless explicitly enabled', async () => {
  await withTempLogFile(async (logPath) => {
    const originalLog = console.log;
    const printed = [];
    console.log = (...args) => printed.push(args.join(' '));
    try {
      const logger = createDaemonLogger(logPath);
      await logger.info('daemon starting');
    } finally {
      console.log = originalLog;
    }
    assert.deepEqual(printed, []);
  });
});

test('createDaemonLogger: verbose:true tees every log entry to stdout, in addition to the file', async () => {
  await withTempLogFile(async (logPath) => {
    const originalLog = console.log;
    const printed = [];
    console.log = (...args) => printed.push(args.join(' '));
    try {
      const logger = createDaemonLogger(logPath, { verbose: true });
      await logger.info('daemon starting', { version: '0.1.0' });
    } finally {
      console.log = originalLog;
    }
    assert.equal(printed.length, 1);
    assert.match(printed[0], /daemon starting/);
    assert.match(printed[0], /"version":"0\.1\.0"/);

    // the file write still happens exactly as without verbose -- tee, not replace.
    const entries = await tailLog(logPath);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].message, 'daemon starting');
  });
});

test('createDaemonLogger: verbose output for a message with no meta has no trailing JSON noise', async () => {
  await withTempLogFile(async (logPath) => {
    const originalLog = console.log;
    const printed = [];
    console.log = (...args) => printed.push(args.join(' '));
    try {
      const logger = createDaemonLogger(logPath, { verbose: true });
      await logger.info('daemon ready');
    } finally {
      console.log = originalLog;
    }
    assert.equal(printed.length, 1);
    assert.doesNotMatch(printed[0], /\{/);
  });
});
