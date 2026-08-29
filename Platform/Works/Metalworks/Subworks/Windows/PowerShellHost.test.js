// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createPowerShellHost } from './PowerShellHost.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeFakeChild({ scriptResponder = () => null } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.writes = [];
  child.killed = false;
  child.stdin = {
    write(text) {
      child.writes.push(text);
      const markerMatch = text.match(/^Write-Output '(###SHIP-METALWORKS-\d+###)'\n$/);
      if (markerMatch) {
        queueMicrotask(() => child.stdout.emit('data', Buffer.from(markerMatch[1])));
        return;
      }
      const response = scriptResponder(text);
      if (response !== null && response !== undefined) {
        queueMicrotask(() => child.stdout.emit('data', Buffer.from(response)));
      }
    },
  };
  child.kill = () => {
    if (child.killed) return;
    child.killed = true;
    queueMicrotask(() => child.emit('exit', null, 'SIGTERM'));
  };
  return child;
}

function makeSpawn({ scriptResponder } = {}) {
  const children = [];
  const spawnFn = () => {
    const child = makeFakeChild({ scriptResponder });
    children.push(child);
    return child;
  };
  spawnFn.children = children;
  return spawnFn;
}

function makeSpawnSwallowingMarkersFrom(startN) {
  const spawn = makeSpawn();
  const swallowed = [];
  const wrappedSpawn = (...args) => {
    const child = spawn(...args);
    const originalWrite = child.stdin.write.bind(child.stdin);
    let markerWrites = 0;
    child.stdin.write = (text) => {
      if (text.startsWith("Write-Output '###SHIP-METALWORKS-")) {
        markerWrites += 1;
        if (markerWrites >= startN) {
          swallowed.push(text);
          return;
        }
      }
      originalWrite(text);
    };
    return child;
  };
  wrappedSpawn.children = spawn.children;
  wrappedSpawn.swallowed = swallowed;
  return wrappedSpawn;
}

function idFromMarkerWrite(text) {
  return text.match(/###SHIP-METALWORKS-(\d+)###/)[1];
}

test('PowerShellHost: send() lazily spawns the persistent host on first use', async (t) => {
  const spawn = makeSpawn();
  const host = createPowerShellHost({ spawn });
  t.after(() => host.stop());
  assert.equal(spawn.children.length, 0);
  await host.send('Write-Output 1', 500);
  assert.equal(spawn.children.length, 1);
});

test('PowerShellHost: resolves a command with whatever the script printed, trimmed', async (t) => {
  const spawn = makeSpawn({
    scriptResponder: (text) => (text.startsWith("Write-Output 'hello'") ? 'hello\n' : null),
  });
  const host = createPowerShellHost({ spawn });
  t.after(() => host.stop());
  const result = await host.send("Write-Output 'hello'", 500);
  assert.equal(result, 'hello');
});

test('PowerShellHost: serializes commands -- a second send() does not write to stdin until the first has genuinely completed', async (t) => {
  const spawn = makeSpawnSwallowingMarkersFrom(2);
  const host = createPowerShellHost({ spawn, commandTimeoutMs: 5000 });
  t.after(() => host.stop());

  const first = host.send('Write-Output 1', 5000);
  await sleep(10);
  assert.equal(spawn.swallowed.length, 1, 'the first real command should be stuck in flight, its marker swallowed');

  const second = host.send('Write-Output 2', 5000);
  await sleep(10);
  const secondWritten = spawn.children[0].writes.some((w) => w.includes('Write-Output 2'));
  assert.equal(secondWritten, false, 'second command must not be written while the first is still in flight');

  const firstId = idFromMarkerWrite(spawn.swallowed[0]);
  spawn.children[0].stdout.emit('data', Buffer.from(`###SHIP-METALWORKS-${firstId}###`));
  await first;

  assert.equal(spawn.children[0].writes.some((w) => w.includes('Write-Output 2')), true, 'second should be written only after the first completed');

  assert.equal(spawn.swallowed.length, 2, "second's marker write should also have been swallowed by this mock, so it needs completing manually too");
  const secondId = idFromMarkerWrite(spawn.swallowed[1]);
  spawn.children[0].stdout.emit('data', Buffer.from(`###SHIP-METALWORKS-${secondId}###`));
  await second;
});

test('PowerShellHost: parses multiple complete marker segments landing in a single buffered stdout read, not just the first', async (t) => {
  const spawn = makeSpawnSwallowingMarkersFrom(2);
  const host = createPowerShellHost({ spawn, commandTimeoutMs: 5000 });
  t.after(() => host.stop());

  const p1 = host.send('Write-Output 1', 5000);
  await sleep(5);
  assert.equal(spawn.swallowed.length, 1, 'p1 should be the one in-flight command, its real marker write swallowed');
  const id1 = Number(idFromMarkerWrite(spawn.swallowed[0]));

  const p2 = host.send('Write-Output 2', 5000);
  const p3 = host.send('Write-Output 3', 5000);

  const id2 = id1 + 1;
  const id3 = id1 + 2;
  const combinedChunk = [
    'p1 output',
    `###SHIP-METALWORKS-${id1}###`,
    'p2 output',
    `###SHIP-METALWORKS-${id2}###`,
    'p3 output',
    `###SHIP-METALWORKS-${id3}###`,
  ].join('');

  spawn.children[0].stdout.emit('data', Buffer.from(combinedChunk));

  const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
  assert.equal(r1, 'p1 output');
  assert.equal(r2, 'p2 output');
  assert.equal(r3, 'p3 output');
  assert.equal(
    spawn.swallowed.length,
    3,
    'p2 and p3 were dispatched (and swallowed on the wire) purely as a side effect of draining p1 -- their real completions never needed a second external event',
  );
});

test('PowerShellHost: a command that never completes times out, rejects, and triggers a respawn', async (t) => {
  const spawn = makeSpawnSwallowingMarkersFrom(2);
  const host = createPowerShellHost({ spawn, commandTimeoutMs: 20 });
  t.after(() => host.stop());

  await assert.rejects(() => host.send('Write-Output 1', 20));
  await sleep(10);
  assert.equal(spawn.children.length, 2, 'a fresh child should have been spawned after the timeout');
});

test('PowerShellHost: an unexpected child exit (crash) triggers a respawn without needing a command timeout', async (t) => {
  const spawn = makeSpawn();
  const host = createPowerShellHost({ spawn, commandTimeoutMs: 2000 });
  t.after(() => host.stop());
  await host.send('Write-Output 1', 500);
  assert.equal(spawn.children.length, 1);

  spawn.children[0].emit('exit', 1, null);
  await sleep(5);
  assert.equal(spawn.children.length, 2);
});

test("PowerShellHost: a deliberate timeout-triggered respawn does not double-respawn from the old child's own exit event", async (t) => {
  const spawn = makeSpawnSwallowingMarkersFrom(2);
  const host = createPowerShellHost({ spawn, commandTimeoutMs: 20 });
  t.after(() => host.stop());

  await assert.rejects(() => host.send('Write-Output 1', 20));
  await sleep(30);
  assert.equal(spawn.children.length, 2);
});

test('PowerShellHost: queued (not-yet-dispatched) commands are rejected, not silently hung, when a timeout triggers a respawn', async (t) => {
  const spawn = makeSpawnSwallowingMarkersFrom(2);
  const host = createPowerShellHost({ spawn, commandTimeoutMs: 20 });
  t.after(() => host.stop());

  const stuck = host.send('Write-Output 1', 20);
  const queued = host.send('Write-Output 2', 2000);
  await assert.rejects(() => stuck);
  await assert.rejects(() => queued);
});

test('PowerShellHost: probeCapability reports ok:true and hostState ready on a clean echo round trip', async (t) => {
  const spawn = makeSpawn({
    scriptResponder: (text) => (text.includes('ship-metalworks-probe-ok') ? 'ship-metalworks-probe-ok\n' : null),
  });
  const host = createPowerShellHost({ spawn });
  t.after(() => host.stop());
  const result = await host.probeCapability();
  assert.equal(result.ok, true);
  assert.equal(host.getHostState(), 'ready');
});

test('PowerShellHost: probeCapability detects an AppLocker/execution-policy denial and reports blocked-by-policy', async (t) => {
  const spawn = makeSpawn({
    scriptResponder: () => 'File cannot be loaded because running scripts is disabled on this system.\n',
  });
  const host = createPowerShellHost({ spawn });
  t.after(() => host.stop());
  const result = await host.probeCapability();
  assert.equal(result.ok, false);
  assert.equal(result.blocked, true);
  assert.equal(host.getHostState(), 'blocked-by-policy');
});

test('PowerShellHost: once blocked-by-policy, further send() calls reject immediately without spawning or writing anything (never a silent cold-spawn-per-tick fallback)', async (t) => {
  const spawn = makeSpawn({
    scriptResponder: () => 'execution of scripts is disabled on this system\n',
  });
  const host = createPowerShellHost({ spawn });
  t.after(() => host.stop());
  await host.probeCapability();
  assert.equal(host.getHostState(), 'blocked-by-policy');

  const spawnCountAfterProbe = spawn.children.length;
  await assert.rejects(() => host.send('Get-Process -Id 1', 200));
  assert.equal(spawn.children.length, spawnCountAfterProbe);
});

test('PowerShellHost: a preventive respawn fires automatically after preventiveRespawnMs while the host is idle', async (t) => {
  const spawn = makeSpawn();
  const host = createPowerShellHost({ spawn, preventiveRespawnMs: 20 });
  t.after(() => host.stop());
  await host.send('Write-Output 1', 500);
  assert.equal(spawn.children.length, 1);
  await sleep(40);
  assert.equal(spawn.children.length, 2);
});

test('PowerShellHost: a preventive respawn is deferred until an in-flight command completes, not fired mid-command, and does not double-fire from a stale duplicate timer', async (t) => {
  // preventiveRespawnMs: 50 -- host created at t=0, first check scheduled for t=50.
  // pending stays stuck past that point, so at t=50 the host sets the deferred-respawn
  // flag and (pre-fix) would reschedule a second, now-stale timer for t=100 without ever
  // clearing it once the deferred respawn actually runs. resolving pending at t=70
  // triggers the real deferred respawn immediately and schedules a fresh cycle for
  // t=120. checking in the (100, 120) window cleanly distinguishes "the stale t=100
  // timer fired a spurious extra respawn" (the bug) from "nothing fires until the
  // legitimate t=120 cycle" (the fix), with margin on both sides against timer jitter.
  const spawn = makeSpawnSwallowingMarkersFrom(2);
  const host = createPowerShellHost({ spawn, preventiveRespawnMs: 50, commandTimeoutMs: 5000 });
  t.after(() => host.stop());

  const pending = host.send('Write-Output 1', 5000);
  await sleep(70);
  assert.equal(spawn.children.length, 1, 'respawn should not happen while a command is still in flight, even past preventiveRespawnMs');

  const id = idFromMarkerWrite(spawn.swallowed[0]);
  spawn.children[0].stdout.emit('data', Buffer.from(`###SHIP-METALWORKS-${id}###`));
  await pending;

  await sleep(10);
  assert.equal(spawn.children.length, 2, 'the deferred preventive respawn should fire exactly once, immediately once the slot frees up');

  await sleep(30);
  assert.equal(
    spawn.children.length,
    2,
    'no stale duplicate timer chain from before the deferred respawn should fire an extra respawn at the old (now-stale) cadence point',
  );
});

test('PowerShellHost: stop() rejects pending work, tears down the child, and prevents further activity', async (t) => {
  const spawn = makeSpawn();
  const host = createPowerShellHost({ spawn, preventiveRespawnMs: 10 });
  t.after(() => host.stop());
  await host.send('Write-Output 1', 500);
  host.stop();
  assert.equal(host.getHostState(), 'down');
  await assert.rejects(() => host.send('Write-Output 2', 500));
  const countAfterStop = spawn.children.length;
  await sleep(30);
  assert.equal(spawn.children.length, countAfterStop);
});
