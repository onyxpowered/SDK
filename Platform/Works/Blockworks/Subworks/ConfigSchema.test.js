// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRIORITY_TIERS,
  validateBlockConfig,
  validateShipConfig,
  validateAllowance,
  validateHealthCheck,
  detectDependencyCycle,
  resolveEntryBlock,
} from './ConfigSchema.js';

test('ConfigSchema: PRIORITY_TIERS is frozen and holds the three settled tiers', () => {
  assert.deepEqual(PRIORITY_TIERS, ['high', 'normal', 'low']);
  assert.ok(Object.isFrozen(PRIORITY_TIERS));
});

test('ConfigSchema: validateBlockConfig rejects a missing command', () => {
  assert.throws(() => validateBlockConfig('web', {}), /missing a command/);
  assert.throws(() => validateBlockConfig('web', { command: '' }), /missing a command/);
});

test('ConfigSchema: validateBlockConfig accepts a minimal valid Block', () => {
  assert.equal(validateBlockConfig('web', { command: 'node server.js' }), true);
});

test('ConfigSchema: validateBlockConfig rejects an invalid priority', () => {
  assert.throws(
    () => validateBlockConfig('web', { command: 'node server.js', priority: 'urgent' }),
    /invalid priority/,
  );
});

test('ConfigSchema: validateBlockConfig rejects a non-array dependsOn', () => {
  assert.throws(
    () => validateBlockConfig('worker', { command: 'node worker.js', dependsOn: 'web' }),
    /dependsOn must be an array/,
  );
});

test('ConfigSchema: validateBlockConfig rejects a non-boolean expose', () => {
  assert.throws(
    () => validateBlockConfig('web', { command: 'node server.js', expose: 'yes' }),
    /expose must be a boolean/,
  );
});

test('ConfigSchema: validateBlockConfig rejects a non-positive readyTimeoutMs', () => {
  assert.throws(
    () => validateBlockConfig('web', { command: 'node server.js', readyTimeoutMs: 0 }),
    /readyTimeoutMs must be a positive number/,
  );
  assert.throws(
    () => validateBlockConfig('web', { command: 'node server.js', readyTimeoutMs: 'soon' }),
    /readyTimeoutMs must be a positive number/,
  );
});

test('ConfigSchema: validateBlockConfig accepts a positive readyTimeoutMs', () => {
  assert.equal(validateBlockConfig('web', { command: 'node server.js', readyTimeoutMs: 45000 }), true);
});

test('ConfigSchema: validateAllowance passes through undefined', () => {
  assert.equal(validateAllowance('web', undefined), true);
});

test('ConfigSchema: validateAllowance rejects a non-object allowance', () => {
  assert.throws(() => validateAllowance('web', 'lots'), /allowance must be an object/);
  assert.throws(() => validateAllowance('web', ['50%']), /allowance must be an object/);
  assert.throws(() => validateAllowance('web', null), /allowance must be an object/);
});

test('ConfigSchema: validateAllowance validates cpu as a percentage string', () => {
  assert.equal(validateAllowance('web', { cpu: '50%' }), true);
  assert.equal(validateAllowance('web', { cpu: '12.5%' }), true);
  assert.throws(() => validateAllowance('web', { cpu: '50' }), /allowance.cpu must be a percentage string/);
  assert.throws(() => validateAllowance('web', { cpu: 50 }), /allowance.cpu must be a percentage string/);
});

test('ConfigSchema: validateAllowance validates memory as a size string', () => {
  assert.equal(validateAllowance('web', { memory: '512mb' }), true);
  assert.equal(validateAllowance('web', { memory: '1GB' }), true);
  assert.throws(() => validateAllowance('web', { memory: '512' }), /allowance.memory must be a size string/);
  assert.throws(() => validateAllowance('web', { memory: '512tb' }), /allowance.memory must be a size string/);
});

test('ConfigSchema: validateHealthCheck passes through undefined', () => {
  assert.equal(validateHealthCheck('web', undefined), true);
});

test('ConfigSchema: validateHealthCheck requires exactly one of port or url', () => {
  assert.throws(() => validateHealthCheck('web', {}), /exactly one of "port" or "url"/);
  assert.throws(
    () => validateHealthCheck('web', { port: 3000, url: 'http://localhost:3000' }),
    /exactly one of "port" or "url"/,
  );
});

test('ConfigSchema: validateHealthCheck validates a port declaration', () => {
  assert.equal(validateHealthCheck('web', { port: 3000 }), true);
  assert.throws(() => validateHealthCheck('web', { port: 0 }), /port must be an integer between 1 and 65535/);
  assert.throws(() => validateHealthCheck('web', { port: 99999 }), /port must be an integer between 1 and 65535/);
  assert.throws(() => validateHealthCheck('web', { port: '3000' }), /port must be an integer between 1 and 65535/);
});

test('ConfigSchema: validateHealthCheck validates a url declaration', () => {
  assert.equal(validateHealthCheck('web', { url: 'http://localhost:3000/health' }), true);
  assert.equal(validateHealthCheck('web', { url: 'https://localhost:3000/health' }), true);
  assert.throws(() => validateHealthCheck('web', { url: 'localhost:3000' }), /must be an http:\/\/ or https:\/\/ string/);
});

test('ConfigSchema: validateHealthCheck validates optional timeoutMs and intervalMs', () => {
  assert.equal(validateHealthCheck('web', { port: 3000, timeoutMs: 5000, intervalMs: 500 }), true);
  assert.throws(
    () => validateHealthCheck('web', { port: 3000, timeoutMs: -1 }),
    /timeoutMs must be a positive number/,
  );
  assert.throws(
    () => validateHealthCheck('web', { port: 3000, intervalMs: 0 }),
    /intervalMs must be a positive number/,
  );
});

test('ConfigSchema: validateShipConfig rejects a missing blocks map', () => {
  assert.throws(() => validateShipConfig({}), /must declare at least one Block/);
  assert.throws(() => validateShipConfig({ blocks: {} }), /must declare at least one Block/);
});

test('ConfigSchema: validateShipConfig rejects an invalid App-level priority', () => {
  assert.throws(
    () => validateShipConfig({ priority: 'urgent', blocks: { web: { command: 'node server.js' } } }),
    /app-level priority is invalid/,
  );
});

test('ConfigSchema: validateShipConfig rejects a dependsOn referencing an unknown Block', () => {
  assert.throws(
    () =>
      validateShipConfig({
        blocks: { web: { command: 'node server.js', dependsOn: ['ghost'] } },
      }),
    /depends on unknown Block "ghost"/,
  );
});

test('ConfigSchema: validateShipConfig accepts a realistic multi-Block config with allowance and healthCheck', () => {
  const config = {
    priority: 'normal',
    blocks: {
      web: {
        command: 'node server.js',
        priority: 'high',
        allowance: { cpu: '50%', memory: '512mb' },
        expose: true,
        healthCheck: { port: 3000 },
      },
      worker: {
        command: 'node worker.js',
        priority: 'low',
        expose: false,
        dependsOn: ['web'],
      },
    },
  };
  assert.equal(validateShipConfig(config), true);
});

test('ConfigSchema: detectDependencyCycle throws on a two-Block cycle', () => {
  assert.throws(
    () =>
      detectDependencyCycle({
        a: { dependsOn: ['b'] },
        b: { dependsOn: ['a'] },
      }),
    /dependency cycle detected/,
  );
});

test('ConfigSchema: detectDependencyCycle throws on a self-referencing Block', () => {
  assert.throws(
    () => detectDependencyCycle({ a: { dependsOn: ['a'] } }),
    /dependency cycle detected/,
  );
});

test('ConfigSchema: detectDependencyCycle passes on a valid DAG', () => {
  assert.doesNotThrow(() =>
    detectDependencyCycle({
      web: { dependsOn: [] },
      worker: { dependsOn: ['web'] },
      cron: { dependsOn: ['web', 'worker'] },
    }),
  );
});

test('ConfigSchema: resolveEntryBlock returns every Block explicitly marked expose:true', () => {
  const config = {
    blocks: {
      web: { command: 'node server.js', expose: true },
      admin: { command: 'node admin.js', expose: true },
      worker: { command: 'node worker.js', expose: false },
    },
  };
  assert.deepEqual(resolveEntryBlock(config).sort(), ['admin', 'web']);
});

test('ConfigSchema: resolveEntryBlock falls back to the sole Block when none declare expose', () => {
  const config = { blocks: { web: { command: 'node server.js' } } };
  assert.deepEqual(resolveEntryBlock(config), ['web']);
});

test('ConfigSchema: resolveEntryBlock returns an empty list when there are multiple Blocks and none expose', () => {
  const config = {
    blocks: {
      web: { command: 'node server.js' },
      worker: { command: 'node worker.js' },
    },
  };
  assert.deepEqual(resolveEntryBlock(config), []);
});
