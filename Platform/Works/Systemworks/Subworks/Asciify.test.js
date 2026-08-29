// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sobelEdges,
  sampleCellMax,
  buildCoverageGrid,
  dilateGrid,
  renderFrame,
  fitToTerminal,
} from './Asciify.js';

// A tiny synthetic "source" for the grid-level functions -- ink is a flat
// Float32Array over a width*height single-channel field, matching what
// loadSource() would hand renderFrame/buildCoverageGrid in the real path.
function makeSource(width, height, fill = () => 0) {
  const ink = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      ink[y * width + x] = fill(x, y);
    }
  }
  return { ink, width, height };
}

test('fitToTerminal: always fills the terminal edge-to-edge horizontally', () => {
  const wide = makeSource(1440, 720);
  const { columns } = fitToTerminal(wide, 120, 30);
  assert.equal(columns, 120);
});

test('fitToTerminal: caps rows to the terminal height rather than shrinking width', () => {
  // A tall, narrow source would want many rows at full width -- must be
  // capped, not solved by narrowing columns.
  const tall = makeSource(100, 1000);
  const { columns, rows } = fitToTerminal(tall, 120, 30);
  assert.equal(columns, 120);
  assert.ok(rows <= 30);
});

test('fitToTerminal: a source whose aspect leaves room uses fewer rows than the terminal offers', () => {
  // 2:1 wide source, standard char-aspect correction (0.5) -> rows = columns * 0.5 * 0.5.
  const wide = makeSource(1440, 720);
  const { rows } = fitToTerminal(wide, 120, 30);
  assert.equal(rows, 30);
});

test('sobelEdges: a flat, uniform field has zero gradient everywhere', () => {
  const flat = new Float32Array(9).fill(0.5);
  const edges = sobelEdges(flat, 3, 3);
  assert.ok([...edges].every((v) => v === 0));
});

test('sobelEdges: a hard vertical edge produces its peak magnitude right at the boundary', () => {
  // 4x3 field: left two columns black, right two columns white.
  const width = 4;
  const height = 3;
  const buf = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      buf[y * width + x] = x < 2 ? 0 : 1;
    }
  }
  const edges = sobelEdges(buf, width, height);
  // normalized 0..1 -- the strongest response should sit on the boundary
  // columns (x=1 or x=2), not out at the flat far edges (x=0 or x=3).
  const middleRow = 1;
  const magnitudeAt = (x) => edges[middleRow * width + x];
  assert.ok(magnitudeAt(1) > magnitudeAt(0));
  assert.ok(magnitudeAt(2) > magnitudeAt(3));
  assert.equal(Math.max(...edges), 1); // normalized so the peak is exactly 1
});

test('sampleCellMax: returns the brightest pixel in the cell, not an average', () => {
  // A single bright pixel in an otherwise-black 4x4 cell -- an average would
  // wash this down to near-zero; max-sampling must preserve it.
  const source = makeSource(4, 4, (x, y) => (x === 3 && y === 3 ? 1 : 0));
  const peak = sampleCellMax(source, 0, 4, 0, 4);
  assert.equal(peak, 1);
});

test('sampleCellMax: an entirely dark cell returns zero', () => {
  const source = makeSource(4, 4, () => 0);
  assert.equal(sampleCellMax(source, 0, 4, 0, 4), 0);
});

test('sampleCellMax: clamps an out-of-range cell to the source bounds instead of throwing', () => {
  const source = makeSource(2, 2, () => 1);
  assert.equal(sampleCellMax(source, 5, 10, 5, 10), 1);
});

test('buildCoverageGrid: downsamples a source into exactly columns x rows cells', () => {
  const source = makeSource(8, 8, () => 0.5);
  const grid = buildCoverageGrid(source, 4, 2);
  assert.equal(grid.length, 8);
});

test('buildCoverageGrid: a bright pixel registers in its own cell without leaking into neighbors', () => {
  // 8x8 source split into a 4x4 grid (2x2 px per cell): light up one pixel
  // in the top-left source cell only.
  const source = makeSource(8, 8, (x, y) => (x === 0 && y === 0 ? 1 : 0));
  const grid = buildCoverageGrid(source, 4, 4);
  assert.equal(grid[0], 1); // top-left cell
  assert.equal(grid[1], 0); // cell to its right
  assert.equal(grid[4], 0); // cell below it
});

test('dilateGrid: a lit cell bleeds into orthogonal neighbors at reduced strength, never full strength', () => {
  const columns = 3;
  const rows = 3;
  const grid = new Float32Array(columns * rows);
  grid[4] = 1; // center cell (row 1, col 1)
  const dilated = dilateGrid(grid, columns, rows);
  assert.equal(dilated[4], 1); // the source cell itself is untouched
  assert.ok(dilated[1] > 0 && dilated[1] < 1); // cell above, orthogonal
  assert.ok(dilated[0] > 0 && dilated[0] < dilated[1]); // corner, diagonal -- weaker than orthogonal
});

test('dilateGrid: never darkens a cell that was already brighter than its bled-into neighbors', () => {
  const columns = 3;
  const rows = 1;
  const grid = new Float32Array([1, 0.9, 0]);
  const dilated = dilateGrid(grid, columns, rows);
  assert.equal(dilated[0], 1);
  // compare against grid[1] itself, not the literal 0.9 -- Float32Array
  // quantizes on write, so the stored value is a hair under the JS double 0.9.
  assert.ok(dilated[1] >= grid[1]);
});

test('renderFrame: an all-dark source renders as pure blank space in the outline ramp', () => {
  const source = { ...makeSource(4, 4, () => 0), ramp: ' .:-=+*#%@', useDilate: false };
  const lines = renderFrame(source, 4, 4);
  for (const line of lines) {
    assert.match(line, /^\x1b\[97m {4}\x1b\[0m$/);
  }
});

test('renderFrame: a fully-lit source uses the densest character in the ramp', () => {
  const ramp = ' .:-=+*#%@';
  const source = { ...makeSource(2, 2, () => 1), ramp, useDilate: false };
  const lines = renderFrame(source, 2, 2);
  const denseChar = ramp[ramp.length - 1];
  for (const line of lines) {
    assert.ok(line.includes(denseChar), `expected the densest glyph "${denseChar}" in: ${line}`);
  }
});

test('renderFrame: every line is wrapped in a plain white ANSI code, not per-pixel color', () => {
  const source = { ...makeSource(3, 1, () => 0.5), ramp: ' .:-=+*#%@', useDilate: false };
  const [line] = renderFrame(source, 3, 1);
  assert.ok(line.startsWith('\x1b[97m'));
  assert.ok(line.endsWith('\x1b[0m'));
  // no other escape codes buried in the middle (i.e. no per-glyph coloring)
  const middle = line.slice('\x1b[97m'.length, -'\x1b[0m'.length);
  assert.doesNotMatch(middle, /\x1b\[/);
});
