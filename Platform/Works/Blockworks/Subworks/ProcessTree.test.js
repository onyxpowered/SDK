// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  spawnBlockProcess,
  isProcessAlive,
  killBlockTree,
  terminateBlockTree,
} from './ProcessTree.js';

const execFileAsync = promisify(execFile);

test('ProcessTree: spawnBlockProcess runs the command through a shell, detached on POSIX', () => {
  let capturedCommand;
  let capturedOptions;
  const spawnFn = (command, options) => {
    capturedCommand = command;
    capturedOptions = options;
    return { pid: 4242 };
  };
  const child = spawnBlockProcess('node server.js', {
    cwd: '/apps/my-app',
    env: { FOO: 'bar' },
    spawnFn,
    platformName: 'linux',
  });
  assert.equal(capturedCommand, 'node server.js');
  assert.equal(capturedOptions.cwd, '/apps/my-app');
  assert.deepEqual(capturedOptions.env, { FOO: 'bar' });
  assert.equal(capturedOptions.shell, true);
  assert.equal(capturedOptions.detached, true);
  assert.equal(child.pid, 4242);
});

test('ProcessTree: spawnBlockProcess never sets detached on Windows', () => {
  let capturedOptions;
  const spawnFn = (command, options) => {
    capturedOptions = options;
    return { pid: 4242 };
  };
  spawnBlockProcess('node server.js', { spawnFn, platformName: 'win32' });
  assert.equal(capturedOptions.detached, false);
});

test('ProcessTree: spawnBlockProcess defaults env to the current process env when none is given', () => {
  let capturedOptions;
  const spawnFn = (command, options) => {
    capturedOptions = options;
    return { pid: 1 };
  };
  spawnBlockProcess('node server.js', { spawnFn, platformName: 'linux' });
  assert.equal(capturedOptions.env, process.env);
});

test('ProcessTree: isProcessAlive returns true for the current process', () => {
  assert.equal(isProcessAlive(process.pid), true);
});

test('ProcessTree: isProcessAlive returns false when the kill probe reports ESRCH', () => {
  const killFn = () => {
    const error = new Error('no such process');
    error.code = 'ESRCH';
    throw error;
  };
  assert.equal(isProcessAlive(99999, { killFn }), false);
});

test('ProcessTree: isProcessAlive returns true when the kill probe reports EPERM (process exists, no permission)', () => {
  const killFn = () => {
    const error = new Error('operation not permitted');
    error.code = 'EPERM';
    throw error;
  };
  assert.equal(isProcessAlive(1, { killFn }), true);
});

test('ProcessTree: killBlockTree on POSIX signals the whole process group via a negative pid', () => {
  let captured;
  const killFn = (target, signal) => {
    captured = { target, signal };
  };
  return killBlockTree(4242, { platformName: 'linux', killFn }).then(() => {
    assert.deepEqual(captured, { target: -4242, signal: 'SIGTERM' });
  });
});

test('ProcessTree: killBlockTree swallows ESRCH (already exited) without throwing', async () => {
  const killFn = () => {
    const error = new Error('no such process');
    error.code = 'ESRCH';
    throw error;
  };
  await assert.doesNotReject(() => killBlockTree(4242, { platformName: 'linux', killFn }));
});

test('ProcessTree: killBlockTree rethrows an unexpected error code', async () => {
  const killFn = () => {
    const error = new Error('unexpected');
    error.code = 'EINVAL';
    throw error;
  };
  await assert.rejects(() => killBlockTree(4242, { platformName: 'linux', killFn }), /unexpected/);
});

test('ProcessTree: killBlockTree on Windows shells out to taskkill /T /F', async () => {
  let captured;
  const execFn = async (cmd, args) => {
    captured = { cmd, args };
    return { stdout: '', stderr: '' };
  };
  await killBlockTree(4242, { platformName: 'win32', execFn });
  assert.equal(captured.cmd, 'taskkill');
  assert.deepEqual(captured.args, ['/PID', '4242', '/T', '/F']);
});

test('ProcessTree: killBlockTree on Windows swallows a "process not found" taskkill failure', async () => {
  const execFn = async () => {
    throw new Error('ERROR: The process "4242" not found.');
  };
  await assert.doesNotReject(() => killBlockTree(4242, { platformName: 'win32', execFn }));
});

test('ProcessTree: terminateBlockTree does not escalate when the process exits within the grace period', async () => {
  let probeCount = 0;
  const killFn = (target, signal) => {
    if (target > 0 && signal === 0) {
      probeCount += 1;
      if (probeCount >= 2) {
        const error = new Error('no such process');
        error.code = 'ESRCH';
        throw error;
      }
      return;
    }
  };
  const result = await terminateBlockTree(4242, {
    platformName: 'linux',
    killFn,
    gracePeriodMs: 5000,
    sleepFn: () => Promise.resolve(),
  });
  assert.equal(result.escalated, false);
});

test('ProcessTree: terminateBlockTree escalates to SIGKILL when the process outlives the grace period', async () => {
  const signalsSent = [];
  const killFn = (target, signal) => {
    if (target > 0 && signal === 0) {
      return;
    }
    signalsSent.push({ target, signal });
  };
  const result = await terminateBlockTree(4242, {
    platformName: 'linux',
    killFn,
    gracePeriodMs: 20,
    sleepFn: () => Promise.resolve(),
  });
  assert.equal(result.escalated, true);
  assert.deepEqual(signalsSent, [
    { target: -4242, signal: 'SIGTERM' },
    { target: -4242, signal: 'SIGKILL' },
  ]);
});

test('ProcessTree: terminateBlockTree never polls for aliveness on Windows (taskkill /T /F is already synchronous)', async () => {
  let pollCount = 0;
  const execFn = async () => ({ stdout: '', stderr: '' });
  const killFn = () => {
    pollCount += 1;
  };
  const result = await terminateBlockTree(4242, { platformName: 'win32', execFn, killFn });
  assert.equal(result.escalated, false);
  assert.equal(pollCount, 0);
});

test(
  'ProcessTree: a real spawned wrapper-shell tree is fully terminated, not just its root PID',
  { skip: process.platform === 'win32' },
  async () => {
    const child = spawnBlockProcess('sleep 30 & sleep 30 & wait', { platformName: process.platform });
    await new Promise((resolve) => setTimeout(resolve, 300));

    async function listChildPids(parentPid) {
      const { stdout } = await execFileAsync('ps', ['-A', '-o', 'pid=,ppid=']);
      return stdout
        .trim()
        .split('\n')
        .map((line) => line.trim().split(/\s+/).map(Number))
        .filter(([, ppid]) => ppid === parentPid)
        .map(([pid]) => pid);
    }

    const childrenBefore = await listChildPids(child.pid);
    assert.ok(childrenBefore.length >= 2, `expected at least 2 sleep children, found ${childrenBefore.length}`);

    await terminateBlockTree(child.pid, { gracePeriodMs: 2000 });
    await new Promise((resolve) => setTimeout(resolve, 200));

    assert.equal(isProcessAlive(child.pid), false);
    const childrenAfter = await listChildPids(child.pid);
    assert.deepEqual(childrenAfter, []);
  },
);
