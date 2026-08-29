// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  system,
  warning,
  error,
  success,
  field,
  formatResult,
} from './Output.js';

const SQUARE = '■';
const RESET = '\x1b[0m';

function stripColor(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

test('Output: system/warning/error/success all use the same square glyph, only the color differs', () => {
  for (const [render, label] of [[system, 'system'], [warning, 'warning'], [error, 'error'], [success, 'success']]) {
    const line = render('hello');
    assert.ok(line.includes(SQUARE), `${label}(...) should contain the square glyph`);
    assert.ok(stripColor(line).endsWith('hello'), `${label}(...) should end with the message text, uncolored`);
  }
});

test('Output: each state renders a genuinely different color code', () => {
  const colorOf = (line) => line.match(/^\x1b\[[0-9;]*m/)[0];
  const colors = new Set([system('x'), warning('x'), error('x'), success('x')].map(colorOf));
  assert.equal(colors.size, 4);
});

test('Output: every render resets color after the glyph, so the message text itself is never tinted', () => {
  for (const render of [system, warning, error, success]) {
    const line = render('plain message');
    const afterGlyph = line.slice(line.indexOf(SQUARE) + SQUARE.length);
    assert.ok(afterGlyph.startsWith(RESET), 'color must reset immediately after the glyph');
  }
});

test('Output: field() renders a labeled prompt ending in ": " with no trailing content after it', () => {
  const prompt = field('email');
  assert.ok(stripColor(prompt).endsWith('email: '));
  assert.ok(prompt.includes(SQUARE));
});

test('Output: field() does not alter the label text -- casing/punctuation is the caller\'s responsibility', () => {
  assert.ok(stripColor(field('Vault export passphrase')).endsWith('Vault export passphrase: '));
});

test('Output: formatResult renders a flat object as one "■ label: value" line per field', () => {
  const rendered = stripColor(formatResult({ accountId: 'acct_1', loggedIn: true }));
  const lines = rendered.split('\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[0], `${SQUARE} account id: acct_1`);
  assert.equal(lines[1], `${SQUARE} logged in: yes`);
});

test('Output: formatResult humanizes camelCase keys into lowercase, space-separated labels', () => {
  const rendered = stripColor(formatResult({ blockName: 'web', appRootDir: '/tmp/x' }));
  assert.match(rendered, /^■ block name: web$/m);
  assert.match(rendered, /^■ app root dir: \/tmp\/x$/m);
});

test('Output: formatResult renders booleans as yes/no, never as the literal words true/false', () => {
  const rendered = stripColor(formatResult({ running: true, configGenerated: false }));
  assert.match(rendered, /running: yes/);
  assert.match(rendered, /config generated: no/);
  assert.doesNotMatch(rendered, /\btrue\b/);
  assert.doesNotMatch(rendered, /\bfalse\b/);
});

test('Output: formatResult renders null/undefined as "(none)"', () => {
  const rendered = stripColor(formatResult({ note: null, detected: undefined }));
  assert.match(rendered, /note: \(none\)/);
  assert.match(rendered, /detected: \(none\)/);
});

test('Output: formatResult joins a non-empty array with ", " and renders an empty array as "(none)"', () => {
  const rendered = stripColor(formatResult({ tags: ['a', 'b', 'c'], entries: [] }));
  assert.match(rendered, /tags: a, b, c/);
  assert.match(rendered, /entries: \(none\)/);
});

test('Output: formatResult recurses into a nested plain object, indenting its fields under a header line', () => {
  const rendered = stripColor(formatResult({ meta: { region: 'us', tier: 'pro' } }));
  const lines = rendered.split('\n');
  assert.equal(lines[0], `${SQUARE} meta:`);
  assert.equal(lines[1], `  ${SQUARE} region: us`);
  assert.equal(lines[2], `  ${SQUARE} tier: pro`);
});

test('Output: formatResult on an empty object renders an empty string', () => {
  assert.equal(formatResult({}), '');
});
