// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeStartWaves,
  flattenStartOrder,
  dependentsOf,
  directDependenciesOf,
  transitiveDependentsOf,
} from './Dependencies.js';

test('Dependencies: computeStartWaves puts every dependency-free Block in the first wave', () => {
  const blocks = {
    web: { dependsOn: [] },
    cache: { dependsOn: [] },
  };
  const waves = computeStartWaves(blocks);
  assert.deepEqual(waves, [['cache', 'web']]);
});

test('Dependencies: computeStartWaves sequences a dependent Block into a later wave', () => {
  const blocks = {
    web: { dependsOn: [] },
    worker: { dependsOn: ['web'] },
  };
  const waves = computeStartWaves(blocks);
  assert.deepEqual(waves, [['web'], ['worker']]);
});

test('Dependencies: computeStartWaves groups independent chains and a diamond correctly', () => {
  const blocks = {
    web: { dependsOn: [] },
    db: { dependsOn: [] },
    api: { dependsOn: ['web', 'db'] },
    worker: { dependsOn: ['api'] },
  };
  const waves = computeStartWaves(blocks);
  assert.deepEqual(waves, [['db', 'web'], ['api'], ['worker']]);
});

test('Dependencies: computeStartWaves treats a Block with no declared dependsOn as depending on nothing', () => {
  const blocks = { web: {} };
  const waves = computeStartWaves(blocks);
  assert.deepEqual(waves, [['web']]);
});

test('Dependencies: computeStartWaves throws a clear error on a cycle instead of looping forever', () => {
  const blocks = {
    a: { dependsOn: ['b'] },
    b: { dependsOn: ['a'] },
  };
  assert.throws(() => computeStartWaves(blocks), /dependency cycle detected/);
});

test('Dependencies: flattenStartOrder concatenates every wave in order', () => {
  const blocks = {
    web: { dependsOn: [] },
    worker: { dependsOn: ['web'] },
    cron: { dependsOn: ['worker'] },
  };
  assert.deepEqual(flattenStartOrder(blocks), ['web', 'worker', 'cron']);
});

test('Dependencies: dependentsOf returns every Block that directly depends on the given name', () => {
  const blocks = {
    web: { dependsOn: [] },
    worker: { dependsOn: ['web'] },
    cron: { dependsOn: ['web'] },
    unrelated: { dependsOn: [] },
  };
  assert.deepEqual(dependentsOf(blocks, 'web').sort(), ['cron', 'worker']);
  assert.deepEqual(dependentsOf(blocks, 'unrelated'), []);
});

test('Dependencies: directDependenciesOf returns a defensive copy of a Block dependsOn list', () => {
  const blocks = { worker: { dependsOn: ['web', 'db'] } };
  const deps = directDependenciesOf(blocks, 'worker');
  assert.deepEqual(deps, ['web', 'db']);
  deps.push('mutated');
  assert.deepEqual(directDependenciesOf(blocks, 'worker'), ['web', 'db']);
});

test('Dependencies: directDependenciesOf returns an empty array for an unknown Block name', () => {
  assert.deepEqual(directDependenciesOf({}, 'ghost'), []);
});

test('Dependencies: transitiveDependentsOf walks the whole downstream chain, not just direct dependents', () => {
  const blocks = {
    web: { dependsOn: [] },
    api: { dependsOn: ['web'] },
    worker: { dependsOn: ['api'] },
    cron: { dependsOn: ['worker'] },
    unrelated: { dependsOn: [] },
  };
  assert.deepEqual(transitiveDependentsOf(blocks, 'web').sort(), ['api', 'cron', 'worker']);
});

test('Dependencies: transitiveDependentsOf returns an empty array for a leaf with no dependents', () => {
  const blocks = { web: { dependsOn: [] }, worker: { dependsOn: ['web'] } };
  assert.deepEqual(transitiveDependentsOf(blocks, 'worker'), []);
});
