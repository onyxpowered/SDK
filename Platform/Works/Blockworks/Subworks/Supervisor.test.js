// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import { createSupervisor } from './Supervisor.js';
import { createTick, createSystemSample, createProcessSample } from '../../Metalworks/Subworks/Schema.js';

function fakeChild(pid) {
  const emitter = new EventEmitter();
  emitter.pid = pid;
  return emitter;
}

function fakeSpawner() {
  let nextPid = 1000;
  const calls = [];
  const children = [];
  const spawnFn = (command, options) => {
    const child = fakeChild(nextPid++);
    calls.push({ command, options, child });
    children.push(child);
    return child;
  };
  return { spawnFn, calls, children };
}

function fakeStateStore() {
  const data = new Map();
  return {
    async writeBlockState(appName, blockName, record) {
      data.set(`${appName}:${blockName}`, record);
    },
    get(appName, blockName) {
      return data.get(`${appName}:${blockName}`);
    },
  };
}

function fakeScheduler() {
  let nextId = 1;
  const pending = new Map();
  return {
    setTimeoutFn: (cb, ms) => {
      const id = nextId++;
      pending.set(id, { cb, ms });
      return id;
    },
    clearTimeoutFn: (id) => {
      pending.delete(id);
    },
    async fireAllPending() {
      const toFire = [...pending.values()];
      pending.clear();
      await Promise.all(toFire.map((entry) => entry.cb()));
    },
    pendingCount() {
      return pending.size;
    },
    pendingDelays() {
      return [...pending.values()].map((entry) => entry.ms);
    },
  };
}

function fakeLogger() {
  const calls = { info: [], warn: [], error: [] };
  return {
    calls,
    async info(message, meta) {
      calls.info.push({ message, meta });
    },
    async warn(message, meta) {
      calls.warn.push({ message, meta });
    },
    async error(message, meta) {
      calls.error.push({ message, meta });
    },
  };
}

function fakeTelemetrySource(initialTick) {
  let tick = initialTick;
  return {
    async getTick() {
      return tick;
    },
    setTick(next) {
      tick = next;
    },
  };
}

function buildTick({
  cpuPercent = 10,
  totalBytes = 1000,
  usedBytes = 100,
  freeBytes = 900,
  perProcess = {},
  systemChannel = 'ok',
  perProcessChannel = 'ok',
} = {}) {
  const system = createSystemSample(cpuPercent, totalBytes, usedBytes, freeBytes, 0);
  return createTick(process.hrtime.bigint(), system, perProcess, systemChannel, perProcessChannel);
}

function sample(pid, cpuPercent, rssBytes) {
  return { [pid]: createProcessSample(cpuPercent, rssBytes, true, 0n, 1000, false) };
}

function minimalConfig(blocks) {
  const normalized = {};
  for (const [name, block] of Object.entries(blocks)) {
    normalized[name] = {
      name,
      command: block.command ?? 'node server.js',
      priority: block.priority ?? 'normal',
      dependsOn: block.dependsOn ?? [],
      expose: block.expose ?? false,
      allowance: block.allowance ?? {},
      healthCheck: block.healthCheck ?? null,
      readyTimeoutMs: block.readyTimeoutMs ?? 30000,
    };
  }
  return { priority: 'normal', blocks: normalized, appRootDir: '/apps/my-app' };
}

test('Supervisor: createSupervisor requires a telemetrySource', () => {
  assert.throws(() => createSupervisor({ stateStore: fakeStateStore() }), /requires a telemetrySource/);
});

test('Supervisor: createSupervisor requires a stateStore', () => {
  assert.throws(
    () => createSupervisor({ telemetrySource: fakeTelemetrySource(buildTick()) }),
    /requires a stateStore/,
  );
});

test('Supervisor: registerApp spawns a single dependency-free Block and brings it to running', async () => {
  const { spawnFn, calls } = fakeSpawner();
  const stateStore = fakeStateStore();
  const supervisor = createSupervisor({
    telemetrySource: fakeTelemetrySource(buildTick()),
    stateStore,
    spawnFn,
  });
  await supervisor.registerApp('my-app', minimalConfig({ web: {} }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.cwd, '/apps/my-app');
  const status = supervisor.getBlockStatus('my-app', 'web');
  assert.equal(status.state, 'running');
  assert.equal(status.pid, calls[0].child.pid);
  assert.equal(stateStore.get('my-app', 'web').state, 'running');
});

test('Supervisor: every lifecycle transition a Block goes through is logged with its from/to state (dev-mode visibility)', async () => {
  const { spawnFn, calls } = fakeSpawner();
  const logger = fakeLogger();
  const supervisor = createSupervisor({
    telemetrySource: fakeTelemetrySource(buildTick()),
    stateStore: fakeStateStore(),
    spawnFn,
    logger,
  });
  await supervisor.registerApp('my-app', minimalConfig({ web: {} }));
  const transitions = logger.calls.info.filter((c) => c.message === 'Block lifecycle transition');
  assert.equal(transitions.length, 1);
  assert.deepEqual(transitions[0].meta, {
    appName: 'my-app',
    blockName: 'web',
    event: 'ready',
    from: 'starting',
    to: 'running',
  });

  await supervisor.stopApp('my-app');
  const stopTransition = logger.calls.info.find((c) => c.message === 'Block lifecycle transition' && c.meta.event === 'stop');
  assert.deepEqual(stopTransition.meta, {
    appName: 'my-app',
    blockName: 'web',
    event: 'stop',
    from: 'running',
    to: 'stopped',
  });
});

test('Supervisor: a configured health check logs its outcome and timing; a Block with none logs no health check at all', async () => {
  const healthySocket = () => {
    const socket = new EventEmitter();
    socket.destroy = () => {};
    socket.removeAllListeners = EventEmitter.prototype.removeAllListeners.bind(socket);
    queueMicrotask(() => socket.emit('connect'));
    return socket;
  };
  const { spawnFn: spawnWithCheck } = fakeSpawner();
  const loggerWithCheck = fakeLogger();
  const supervisorWithCheck = createSupervisor({
    telemetrySource: fakeTelemetrySource(buildTick()),
    stateStore: fakeStateStore(),
    spawnFn: spawnWithCheck,
    logger: loggerWithCheck,
    probeOptions: { connectFn: healthySocket },
  });
  await supervisorWithCheck.registerApp(
    'my-app',
    minimalConfig({ web: { healthCheck: { port: 1, timeoutMs: 2000 }, readyTimeoutMs: 2000 } }),
  );
  const checks = loggerWithCheck.calls.info.filter((c) => c.message === 'Block health check');
  assert.equal(checks.length, 1);
  assert.equal(checks[0].meta.appName, 'my-app');
  assert.equal(checks[0].meta.blockName, 'web');
  assert.equal(checks[0].meta.healthy, true);
  assert.equal(typeof checks[0].meta.durationMs, 'number');

  const { spawnFn: spawnNoCheck } = fakeSpawner();
  const loggerNoCheck = fakeLogger();
  const supervisorNoCheck = createSupervisor({
    telemetrySource: fakeTelemetrySource(buildTick()),
    stateStore: fakeStateStore(),
    spawnFn: spawnNoCheck,
    logger: loggerNoCheck,
  });
  await supervisorNoCheck.registerApp('my-app', minimalConfig({ web: {} }));
  assert.equal(loggerNoCheck.calls.info.filter((c) => c.message === 'Block health check').length, 0);
});

test('Supervisor: registerApp merges extraEnv into the spawned Block\'s process environment', async () => {
  const { spawnFn, calls } = fakeSpawner();
  const supervisor = createSupervisor({
    telemetrySource: fakeTelemetrySource(buildTick()),
    stateStore: fakeStateStore(),
    spawnFn,
  });
  await supervisor.registerApp('my-app', minimalConfig({ web: {} }), { SHIP_BASE_PATH: '/my-app' });
  assert.equal(calls[0].options.env.SHIP_BASE_PATH, '/my-app');
  // The rest of the daemon's own environment must still be there too --
  // extraEnv augments it, it doesn't replace it.
  assert.equal(calls[0].options.env.PATH, process.env.PATH);
});

test('Supervisor: registerApp with no extraEnv still spawns with the daemon\'s own environment (spawnBlockProcess\'s existing default, unaffected)', async () => {
  const { spawnFn, calls } = fakeSpawner();
  const supervisor = createSupervisor({
    telemetrySource: fakeTelemetrySource(buildTick()),
    stateStore: fakeStateStore(),
    spawnFn,
  });
  await supervisor.registerApp('my-app', minimalConfig({ web: {} }));
  // Supervisor.js passes env: undefined through to spawnBlockProcess when
  // there's no extraEnv -- spawnBlockProcess's own `env ?? process.env`
  // default resolves it from there, same as before this feature existed.
  assert.equal(calls[0].options.env, process.env);
});

test('Supervisor: registerApp waits for a dependency to be running before spawning the dependent Block', async () => {
  const { spawnFn, calls } = fakeSpawner();
  const supervisor = createSupervisor({
    telemetrySource: fakeTelemetrySource(buildTick()),
    stateStore: fakeStateStore(),
    spawnFn,
  });
  await supervisor.registerApp(
    'my-app',
    minimalConfig({
      web: {},
      worker: { dependsOn: ['web'] },
    }),
  );
  assert.equal(calls.length, 2);
  assert.equal(supervisor.getBlockStatus('my-app', 'web').state, 'running');
  assert.equal(supervisor.getBlockStatus('my-app', 'worker').state, 'running');
});

test('Supervisor: a Block whose dependency never becomes ready times out into crashed, then restarting', async () => {
  const scheduler = fakeScheduler();
  const spawnFn = (command) => {
    if (command === 'node ghost.js') {
      throw new Error('ghost refuses to spawn');
    }
    return fakeChild(9999);
  };
  const supervisor = createSupervisor({
    telemetrySource: fakeTelemetrySource(buildTick()),
    stateStore: fakeStateStore(),
    spawnFn,
    setTimeoutFn: scheduler.setTimeoutFn,
    clearTimeoutFn: scheduler.clearTimeoutFn,
    sleepFn: () => Promise.resolve(),
  });
  await supervisor.registerApp(
    'my-app',
    minimalConfig({
      ghost: { command: 'node ghost.js' },
      worker: { dependsOn: ['ghost'], readyTimeoutMs: 50 },
    }),
  );
  assert.equal(supervisor.getBlockStatus('my-app', 'ghost').state, 'restarting');
  assert.equal(supervisor.getBlockStatus('my-app', 'worker').state, 'restarting');
});

test('Supervisor: an unexpected exit crashes the Block and a backoff timer schedules a restart attempt', async () => {
  const { spawnFn, calls } = fakeSpawner();
  const scheduler = fakeScheduler();
  const supervisor = createSupervisor({
    telemetrySource: fakeTelemetrySource(buildTick()),
    stateStore: fakeStateStore(),
    spawnFn,
    setTimeoutFn: scheduler.setTimeoutFn,
    clearTimeoutFn: scheduler.clearTimeoutFn,
  });
  await supervisor.registerApp('my-app', minimalConfig({ web: {} }));
  assert.equal(supervisor.getBlockStatus('my-app', 'web').state, 'running');

  calls[0].child.emit('exit', 1, null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(supervisor.getBlockStatus('my-app', 'web').state, 'restarting');
  assert.equal(scheduler.pendingCount(), 1);
  assert.deepEqual(scheduler.pendingDelays(), [1000]);

  await scheduler.fireAllPending();
  assert.equal(calls.length, 2);
  assert.equal(supervisor.getBlockStatus('my-app', 'web').state, 'running');
});

test('Supervisor: a Block that crashes immediately fails fast instead of waiting out the full health-check timeout (real bug: 30s wait for a process already dead)', async () => {
  const { spawnFn, calls } = fakeSpawner();
  const scheduler = fakeScheduler();
  const supervisor = createSupervisor({
    telemetrySource: fakeTelemetrySource(buildTick()),
    stateStore: fakeStateStore(),
    spawnFn,
    killFn: () => {
      const error = new Error('no such process');
      error.code = 'ESRCH';
      throw error;
    },
    setTimeoutFn: scheduler.setTimeoutFn,
    clearTimeoutFn: scheduler.clearTimeoutFn,
    sleepFn: () => Promise.resolve(),
    gracePeriodMs: 5,
    // probePort's own internal per-attempt timeout is a REAL, uninjectable
    // setTimeout (not the fake scheduler above) -- so a socket that just
    // hangs forever (never emits 'connect' or 'error') genuinely only
    // resolves via that real timer, at the full healthCheck.timeoutMs below.
    // That's what makes this test meaningful: if the exit-race fix is
    // missing, this really does take ~2s of real wall-clock time; if it's
    // working, the child's exit wins long before the probe's own timer ever
    // fires.
    probeOptions: {
      connectFn: () => {
        const socket = new EventEmitter();
        socket.destroy = () => {};
        socket.removeAllListeners = EventEmitter.prototype.removeAllListeners.bind(socket);
        return socket;
      },
    },
  });

  const registerPromise = supervisor.registerApp(
    'my-app',
    minimalConfig({ web: { healthCheck: { port: 1, timeoutMs: 2000 }, readyTimeoutMs: 2000 } }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1, 'the Block should have spawned before crashing');
  calls[0].child.emit('exit', 1, null);

  const start = Date.now();
  await registerPromise;
  const elapsedMs = Date.now() - start;

  assert.ok(elapsedMs < 500, `registerApp should return almost immediately on an early crash, took ${elapsedMs}ms (a broken exit-race would take ~2000ms)`);
  assert.equal(supervisor.getBlockStatus('my-app', 'web').state, 'restarting');
});

test('Supervisor: a stale exit from a superseded restart attempt never crashes the lifecycle transition (real bug: "cannot ... from restarting")', async () => {
  // Reproduces the exact production failure: a Block whose health check never
  // passes gets stuck readiness-timeout -> crashed -> restarting on every
  // attempt. Each failed attempt's own process kill is async (a real OS exit
  // takes real wall-clock time); if that exit event only reaches this
  // Supervisor after the NEXT restart attempt has already begun (a very
  // plausible race under real backoff timing), the exit handler used to act
  // on record state that had already moved on, throwing "invalid lifecycle
  // transition: cannot ... from restarting" -- observed for real as a
  // deploy that would hang forever (Blockworks never getting past
  // "restarting" cleanly) and manifested to the CLI as "IPC request timed
  // out", nothing about the actual bug.
  const { spawnFn, calls } = fakeSpawner();
  const scheduler = fakeScheduler();
  const errors = [];
  const logger = {
    info() {},
    warn() {},
    error(message, meta) {
      errors.push({ message, meta });
    },
  };
  const deadSocket = () => {
    const socket = new EventEmitter();
    socket.destroy = () => {};
    socket.removeAllListeners = EventEmitter.prototype.removeAllListeners.bind(socket);
    queueMicrotask(() => socket.emit('error', new Error('ECONNREFUSED')));
    return socket;
  };
  const supervisor = createSupervisor({
    telemetrySource: fakeTelemetrySource(buildTick()),
    stateStore: fakeStateStore(),
    spawnFn,
    killFn: () => {
      const error = new Error('no such process');
      error.code = 'ESRCH';
      throw error;
    },
    setTimeoutFn: scheduler.setTimeoutFn,
    clearTimeoutFn: scheduler.clearTimeoutFn,
    sleepFn: () => Promise.resolve(),
    gracePeriodMs: 5,
    probeOptions: { connectFn: deadSocket },
    logger,
  });

  await supervisor.registerApp(
    'my-app',
    minimalConfig({ web: { healthCheck: { port: 1, timeoutMs: 5 }, readyTimeoutMs: 5 } }),
  );
  assert.equal(supervisor.getBlockStatus('my-app', 'web').state, 'restarting');
  assert.equal(calls.length, 1, 'first attempt should have spawned exactly one child');

  // The first attempt's restart is scheduled but not yet fired -- fire it now,
  // starting a second attempt (a new generation) while the first attempt's
  // child has NOT yet reported its exit (simulating a real, slower-to-die OS
  // process).
  await scheduler.fireAllPending();
  assert.equal(supervisor.getBlockStatus('my-app', 'web').state, 'restarting');
  assert.equal(calls.length, 2, 'the restart should have spawned a second child');

  // The first (now stale, superseded) child's exit finally arrives.
  calls[0].child.emit('exit', null, 'SIGKILL');
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(
    errors.filter((e) => e.message.includes('handleExit failed')),
    [],
    'the stale exit must not crash handleExit',
  );
  assert.equal(
    supervisor.getBlockStatus('my-app', 'web').state,
    'restarting',
    'the stale exit must not have altered the current (second) attempt\'s state',
  );

  // The supervisor should still be making real forward progress -- the
  // second attempt's own restart is scheduled, not stuck.
  assert.equal(scheduler.pendingCount(), 1);
});

test('Supervisor: a deliberate stop never triggers a restart, even once the process later exits', async () => {
  const { spawnFn, calls } = fakeSpawner();
  const scheduler = fakeScheduler();
  const supervisor = createSupervisor({
    telemetrySource: fakeTelemetrySource(buildTick()),
    stateStore: fakeStateStore(),
    spawnFn,
    killFn: () => {},
    setTimeoutFn: scheduler.setTimeoutFn,
    clearTimeoutFn: scheduler.clearTimeoutFn,
    sleepFn: () => Promise.resolve(),
    gracePeriodMs: 20,
  });
  await supervisor.registerApp('my-app', minimalConfig({ web: {} }));
  await supervisor.stopBlock('my-app', 'web');
  assert.equal(supervisor.getBlockStatus('my-app', 'web').state, 'stopped');

  calls[0].child.emit('exit', 0, 'SIGTERM');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(supervisor.getBlockStatus('my-app', 'web').state, 'stopped');
  assert.equal(calls.length, 1);
  assert.equal(scheduler.pendingCount(), 0);
});

test('Supervisor: registerApp can redeploy an app under the same name after it was stopped (real bug: "already registered" forever)', async () => {
  // stopBlock() deliberately leaves the record behind so status/logs stay
  // queryable for a stopped app -- registerApp used to treat that leftover
  // record as a permanent name collision, so `ship stop <app>` followed by
  // `ship deploy` for the exact same app would fail with "Block ... is
  // already registered" until the whole daemon was restarted. Real user
  // impact: stop, fix a config mistake, redeploy -- and it just breaks.
  const { spawnFn, calls } = fakeSpawner();
  const supervisor = createSupervisor({
    telemetrySource: fakeTelemetrySource(buildTick()),
    stateStore: fakeStateStore(),
    spawnFn,
    killFn: () => {
      const error = new Error('no such process');
      error.code = 'ESRCH';
      throw error;
    },
    sleepFn: () => Promise.resolve(),
    gracePeriodMs: 5,
  });

  await supervisor.registerApp('my-app', minimalConfig({ web: {} }));
  await supervisor.stopApp('my-app');
  assert.equal(supervisor.getBlockStatus('my-app', 'web').state, 'stopped');

  await assert.doesNotReject(supervisor.registerApp('my-app', minimalConfig({ web: {} })));
  assert.equal(supervisor.getBlockStatus('my-app', 'web').state, 'running');
  assert.equal(calls.length, 2, 'the second registerApp should have spawned a genuinely new process');
});

test('Supervisor: registerApp still refuses a real name collision with an actively running Block', async () => {
  const { spawnFn } = fakeSpawner();
  const supervisor = createSupervisor({
    telemetrySource: fakeTelemetrySource(buildTick()),
    stateStore: fakeStateStore(),
    spawnFn,
  });
  await supervisor.registerApp('my-app', minimalConfig({ web: {} }));
  assert.equal(supervisor.getBlockStatus('my-app', 'web').state, 'running');

  await assert.rejects(
    () => supervisor.registerApp('my-app', minimalConfig({ web: {} })),
    /already registered/,
  );
});

test('Supervisor: stopApp stops every Block under that App in reverse dependency order', async () => {
  const { spawnFn } = fakeSpawner();
  const supervisor = createSupervisor({
    telemetrySource: fakeTelemetrySource(buildTick()),
    stateStore: fakeStateStore(),
    spawnFn,
    killFn: () => {},
    gracePeriodMs: 20,
  });
  await supervisor.registerApp(
    'my-app',
    minimalConfig({
      web: {},
      worker: { dependsOn: ['web'] },
    }),
  );
  const order = await supervisor.stopApp('my-app');
  assert.deepEqual(order, ['worker', 'web']);
  assert.equal(supervisor.getBlockStatus('my-app', 'web').state, 'stopped');
  assert.equal(supervisor.getBlockStatus('my-app', 'worker').state, 'stopped');
});

test('Supervisor: getAppStatus reports every Block registered under that App', async () => {
  const { spawnFn } = fakeSpawner();
  const supervisor = createSupervisor({
    telemetrySource: fakeTelemetrySource(buildTick()),
    stateStore: fakeStateStore(),
    spawnFn,
  });
  await supervisor.registerApp('my-app', minimalConfig({ web: {}, worker: {} }));
  const status = supervisor.getAppStatus('my-app');
  assert.deepEqual(Object.keys(status).sort(), ['web', 'worker']);
  assert.equal(status.web.state, 'running');
});

test('Supervisor: runTick skips per-Block reactions entirely when the perProcessChannel is degraded', async () => {
  const { spawnFn, calls } = fakeSpawner();
  const priorityCalls = [];
  const telemetry = fakeTelemetrySource(buildTick());
  const supervisor = createSupervisor({
    telemetrySource: telemetry,
    stateStore: fakeStateStore(),
    spawnFn,
    setPriorityFn: (pid, priority) => priorityCalls.push({ pid, priority }),
  });
  await supervisor.registerApp('my-app', minimalConfig({ web: { allowance: { cpu: '10%' } } }));
  const pid = calls[0].child.pid;

  telemetry.setTick(buildTick({ perProcess: sample(pid, 99, 0), perProcessChannel: 'degraded' }));
  const result = await supervisor.runTick();
  assert.equal(result.perProcessOk, false);
  assert.equal(priorityCalls.length, 0);
  assert.equal(supervisor.getBlockStatus('my-app', 'web').throttleLevel, 'none');
});

test('Supervisor: a per-Block cpu breach escalates to priority-lowering on the first breaching tick', async () => {
  const { spawnFn, calls } = fakeSpawner();
  const priorityCalls = [];
  const telemetry = fakeTelemetrySource(buildTick());
  const supervisor = createSupervisor({
    telemetrySource: telemetry,
    stateStore: fakeStateStore(),
    spawnFn,
    setPriorityFn: (pid, priority) => priorityCalls.push({ pid, priority }),
  });
  await supervisor.registerApp('my-app', minimalConfig({ web: { allowance: { cpu: '10%' } } }));
  const pid = calls[0].child.pid;

  telemetry.setTick(buildTick({ perProcess: sample(pid, 90, 0) }));
  await supervisor.runTick();

  assert.equal(supervisor.getBlockStatus('my-app', 'web').throttleLevel, 'priority-lowered');
  assert.deepEqual(priorityCalls, [{ pid, priority: os.constants.priority.PRIORITY_LOW }]);
  assert.equal(supervisor.getBlockStatus('my-app', 'web').throttled, true);
});

test('Supervisor: sustained per-Block breach escalates from priority-lowered to duty-cycled on POSIX', async () => {
  const { spawnFn, calls } = fakeSpawner();
  const signals = [];
  const scheduler = fakeScheduler();
  const telemetry = fakeTelemetrySource(buildTick());
  const supervisor = createSupervisor({
    telemetrySource: telemetry,
    stateStore: fakeStateStore(),
    spawnFn,
    setPriorityFn: () => {},
    signalFn: (pid, signal) => signals.push({ pid, signal }),
    setTimeoutFn: scheduler.setTimeoutFn,
    clearTimeoutFn: scheduler.clearTimeoutFn,
    platformName: 'linux',
  });
  await supervisor.registerApp('my-app', minimalConfig({ web: { allowance: { cpu: '10%' } } }));
  const pid = calls[0].child.pid;
  telemetry.setTick(buildTick({ perProcess: sample(pid, 90, 0) }));

  await supervisor.runTick();
  assert.equal(supervisor.getBlockStatus('my-app', 'web').throttleLevel, 'priority-lowered');

  await supervisor.runTick();
  assert.equal(supervisor.getBlockStatus('my-app', 'web').throttleLevel, 'duty-cycled');
  assert.equal(scheduler.pendingCount(), 1);
});

test('Supervisor: throttle de-escalates only after enough consecutive clean ticks, then restores normal priority', async () => {
  const { spawnFn, calls } = fakeSpawner();
  const priorityCalls = [];
  const telemetry = fakeTelemetrySource(buildTick());
  const supervisor = createSupervisor({
    telemetrySource: telemetry,
    stateStore: fakeStateStore(),
    spawnFn,
    setPriorityFn: (pid, priority) => priorityCalls.push({ pid, priority }),
    hysteresisTicks: 2,
  });
  await supervisor.registerApp('my-app', minimalConfig({ web: { allowance: { cpu: '10%' } } }));
  const pid = calls[0].child.pid;

  telemetry.setTick(buildTick({ perProcess: sample(pid, 90, 0) }));
  await supervisor.runTick();
  assert.equal(supervisor.getBlockStatus('my-app', 'web').throttleLevel, 'priority-lowered');

  telemetry.setTick(buildTick({ perProcess: sample(pid, 1, 0) }));
  await supervisor.runTick();
  assert.equal(supervisor.getBlockStatus('my-app', 'web').throttleLevel, 'priority-lowered');

  await supervisor.runTick();
  assert.equal(supervisor.getBlockStatus('my-app', 'web').throttleLevel, 'none');
  assert.equal(supervisor.getBlockStatus('my-app', 'web').throttled, false);
  assert.deepEqual(priorityCalls.at(-1), { pid, priority: os.constants.priority.PRIORITY_NORMAL });
});

test('Supervisor: a Block sustained at max throttle for hysteresisTicks is killed and then restarted via backoff', async () => {
  const { spawnFn, calls } = fakeSpawner();
  const scheduler = fakeScheduler();
  const telemetry = fakeTelemetrySource(buildTick());
  const supervisor = createSupervisor({
    telemetrySource: telemetry,
    stateStore: fakeStateStore(),
    spawnFn,
    setPriorityFn: () => {},
    signalFn: () => {},
    killFn: () => {},
    setTimeoutFn: scheduler.setTimeoutFn,
    clearTimeoutFn: scheduler.clearTimeoutFn,
    sleepFn: () => Promise.resolve(),
    gracePeriodMs: 20,
    platformName: 'linux',
    hysteresisTicks: 2,
  });
  await supervisor.registerApp('my-app', minimalConfig({ web: { allowance: { cpu: '10%' } } }));
  const pid = calls[0].child.pid;
  telemetry.setTick(buildTick({ perProcess: sample(pid, 90, 0) }));

  await supervisor.runTick();
  assert.equal(supervisor.getBlockStatus('my-app', 'web').throttleLevel, 'priority-lowered');
  await supervisor.runTick();
  assert.equal(supervisor.getBlockStatus('my-app', 'web').throttleLevel, 'duty-cycled');
  await supervisor.runTick();
  await supervisor.runTick();

  calls[0].child.emit('exit', null, 'SIGKILL');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(supervisor.getBlockStatus('my-app', 'web').state, 'restarting');
});

test('Supervisor: a universal ceiling breach throttles the lowest-priority, highest-consuming Block first', async () => {
  const { spawnFn, calls } = fakeSpawner();
  const priorityCalls = [];
  const telemetry = fakeTelemetrySource(buildTick());
  const supervisor = createSupervisor({
    telemetrySource: telemetry,
    stateStore: fakeStateStore(),
    spawnFn,
    setPriorityFn: (pid, priority) => priorityCalls.push({ pid, priority }),
  });
  await supervisor.registerApp(
    'my-app',
    minimalConfig({
      web: { priority: 'high' },
      cron: { priority: 'low' },
      worker: { priority: 'low' },
    }),
  );
  const [webPid, cronPid, workerPid] = calls.map((c) => c.child.pid);

  telemetry.setTick(
    buildTick({
      cpuPercent: 95,
      perProcess: {
        ...sample(webPid, 10, 0),
        ...sample(cronPid, 20, 0),
        ...sample(workerPid, 60, 0),
      },
    }),
  );
  await supervisor.runTick();

  assert.equal(supervisor.getBlockStatus('my-app', 'worker').throttleLevel, 'priority-lowered');
  assert.equal(supervisor.getBlockStatus('my-app', 'cron').throttleLevel, 'none');
  assert.equal(supervisor.getBlockStatus('my-app', 'web').throttleLevel, 'none');
  assert.deepEqual(priorityCalls, [{ pid: workerPid, priority: os.constants.priority.PRIORITY_LOW }]);
});

test('Supervisor: runTick skips reacting entirely on an invalid tick', async () => {
  const { spawnFn } = fakeSpawner();
  const priorityCalls = [];
  const telemetry = fakeTelemetrySource(buildTick());
  const supervisor = createSupervisor({
    telemetrySource: telemetry,
    stateStore: fakeStateStore(),
    spawnFn,
    setPriorityFn: (pid, priority) => priorityCalls.push({ pid, priority }),
  });
  await supervisor.registerApp('my-app', minimalConfig({ web: { allowance: { cpu: '1%' } } }));
  telemetry.setTick({ garbage: true });
  const result = await supervisor.runTick();
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'invalid-tick');
  assert.equal(priorityCalls.length, 0);
});

test('Supervisor: runTick tolerates a telemetry source that throws, skipping that tick instead of crashing', async () => {
  const { spawnFn } = fakeSpawner();
  const supervisor = createSupervisor({
    telemetrySource: { getTick: async () => { throw new Error('telemetry unavailable'); } },
    stateStore: fakeStateStore(),
    spawnFn,
  });
  await supervisor.registerApp('my-app', minimalConfig({ web: {} }));
  const result = await supervisor.runTick();
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'telemetry-fetch-failed');
});

test('Supervisor: startPolling repeatedly calls runTick on the configured cadence and stopPolling halts it', async () => {
  const { spawnFn } = fakeSpawner();
  const scheduler = fakeScheduler();
  let tickCount = 0;
  const supervisor = createSupervisor({
    telemetrySource: { getTick: async () => { tickCount += 1; return buildTick(); } },
    stateStore: fakeStateStore(),
    spawnFn,
    setTimeoutFn: scheduler.setTimeoutFn,
    clearTimeoutFn: scheduler.clearTimeoutFn,
    tickIntervalMs: 500,
  });
  supervisor.startPolling();
  assert.equal(scheduler.pendingCount(), 1);
  assert.deepEqual(scheduler.pendingDelays(), [500]);

  await scheduler.fireAllPending();
  assert.equal(tickCount, 1);
  assert.equal(scheduler.pendingCount(), 1);

  supervisor.stopPolling();
  await scheduler.fireAllPending();
  assert.equal(tickCount, 1);
});
