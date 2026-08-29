// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkList, DEFAULT_CHUNK_SIZE } from './Chunk.js';

test('Chunk: splits a list into chunks of the requested size', () => {
  const items = Array.from({ length: 25 }, (_, i) => i);
  const chunks = chunkList(items, 10);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].length, 10);
  assert.equal(chunks[1].length, 10);
  assert.equal(chunks[2].length, 5);
  assert.deepEqual(chunks.flat(), items);
});

test('Chunk: an empty list produces zero chunks', () => {
  assert.deepEqual(chunkList([], 10), []);
});

test('Chunk: a list smaller than the chunk size produces a single chunk', () => {
  assert.deepEqual(chunkList([1, 2, 3], 10), [[1, 2, 3]]);
});

test('Chunk: defaults to DEFAULT_CHUNK_SIZE (within the 10-15 range Plan.txt section 7 specifies)', () => {
  assert.ok(DEFAULT_CHUNK_SIZE >= 10 && DEFAULT_CHUNK_SIZE <= 15);
  const items = Array.from({ length: DEFAULT_CHUNK_SIZE + 1 }, (_, i) => i);
  const chunks = chunkList(items);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].length, DEFAULT_CHUNK_SIZE);
});

test('Chunk: rejects a non-array input', () => {
  assert.throws(() => chunkList('not-an-array'), TypeError);
});

test('Chunk: rejects a zero or negative chunk size', () => {
  assert.throws(() => chunkList([1, 2], 0), RangeError);
  assert.throws(() => chunkList([1, 2], -3), RangeError);
});

test('Chunk: rejects a non-integer chunk size', () => {
  assert.throws(() => chunkList([1, 2], 1.5), RangeError);
});
