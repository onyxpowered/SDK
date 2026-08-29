// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDescendants, resolveDescendantsForRoots, buildChildrenLookup, DEFAULT_MAX_TREE_NODES } from './Tree.js';

function mapLookup(childrenMap) {
  return async (pid) => childrenMap.get(pid) ?? [];
}

test('Tree: a root with no children resolves to just itself', async () => {
  const { pids, truncated } = await resolveDescendants(1, mapLookup(new Map()));
  assert.deepEqual([...pids], [1]);
  assert.equal(truncated, false);
});

test('Tree: enumerates the full descendant tree, not just direct children (npm start -> node case)', async () => {
  const children = new Map([
    [1, [2]],
    [2, [3]],
    [3, []],
  ]);
  const { pids } = await resolveDescendants(1, mapLookup(children));
  assert.deepEqual([...pids].sort(), [1, 2, 3]);
});

test('Tree: enumerates a fan-out tree with multiple children per node', async () => {
  const children = new Map([
    [1, [2, 3]],
    [2, [4, 5]],
    [3, []],
    [4, []],
    [5, []],
  ]);
  const { pids } = await resolveDescendants(1, mapLookup(children));
  assert.deepEqual([...pids].sort((a, b) => a - b), [1, 2, 3, 4, 5]);
});

test('Tree: is resilient to a cycle in the reported parent/child data (defensive, should never happen in real process trees)', async () => {
  const children = new Map([
    [1, [2]],
    [2, [1]],
  ]);
  const { pids } = await resolveDescendants(1, mapLookup(children));
  assert.deepEqual([...pids].sort(), [1, 2]);
});

test('Tree: getChildren throwing for one node does not abort the whole walk', async () => {
  const lookup = async (pid) => {
    if (pid === 2) throw new Error('boom');
    if (pid === 1) return [2, 3];
    return [];
  };
  const { pids } = await resolveDescendants(1, lookup);
  assert.deepEqual([...pids].sort(), [1, 2, 3]);
});

test('Tree: truncates and flags when the tree exceeds maxNodes (runaway/cycle safety net)', async () => {
  const children = new Map();
  for (let i = 0; i < 50; i++) {
    children.set(i, [i + 1]);
  }
  const { pids, truncated } = await resolveDescendants(0, mapLookup(children), { maxNodes: 10 });
  assert.equal(truncated, true);
  assert.ok(pids.size <= 10);
});

test('Tree: DEFAULT_MAX_TREE_NODES is a sane large safety cap', () => {
  assert.ok(DEFAULT_MAX_TREE_NODES >= 500);
});

test('Tree: resolveDescendantsForRoots resolves an independent tree per tracked root', async () => {
  const children = new Map([
    [10, [11]],
    [11, []],
    [20, [21, 22]],
    [21, []],
    [22, []],
  ]);
  const results = await resolveDescendantsForRoots([10, 20], mapLookup(children));
  assert.deepEqual([...results.get(10).pids].sort(), [10, 11]);
  assert.deepEqual([...results.get(20).pids].sort(), [20, 21, 22]);
});

test('Tree: resolveDescendantsForRoots calls getChildren at most once per distinct pid across all roots (caching)', async () => {
  let calls = 0;
  const lookup = async (pid) => {
    calls += 1;
    if (pid === 1) return [3];
    if (pid === 2) return [3];
    return [];
  };
  await resolveDescendantsForRoots([1, 2], lookup);
  assert.equal(calls, 3);
});

test('Tree: buildChildrenLookup inverts a flat pid->ppid map (Linux ppid-chase / Windows Win32_Process shape)', () => {
  const parentPidByPid = new Map([
    [1, null],
    [2, 1],
    [3, 1],
    [4, 2],
  ]);
  const getChildren = buildChildrenLookup(parentPidByPid);
  assert.deepEqual(getChildren(1).sort(), [2, 3]);
  assert.deepEqual(getChildren(2), [4]);
  assert.deepEqual(getChildren(4), []);
});

test('Tree: buildChildrenLookup ignores entries with a null/undefined parent (roots, kernel threads)', () => {
  const parentPidByPid = new Map([
    [1, null],
    [2, undefined],
  ]);
  const getChildren = buildChildrenLookup(parentPidByPid);
  assert.deepEqual(getChildren(undefined), []);
  assert.deepEqual(getChildren(null), []);
});
