// SDK
// Designed & Built By onyxpowered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROTOCOL_VERSION,
  MESSAGE_TYPES,
  encodeMessage,
  decodeMessage,
  decodeBody,
  createHelloMessage,
  createHelloAckMessage,
  createPingMessage,
  createPongMessage,
  createRequestMessage,
  createResponseMessage,
  createErrorMessage,
} from './Protocol.js';

test('encodeMessage/decodeMessage round-trip a well-formed message', () => {
  const message = createPingMessage();
  const decoded = decodeMessage(encodeMessage(message));
  assert.deepEqual(decoded, message);
});

test('decodeMessage accepts a Buffer as well as a string', () => {
  const message = createPongMessage();
  const decoded = decodeMessage(Buffer.from(encodeMessage(message), 'utf8'));
  assert.deepEqual(decoded, message);
});

test('decodeMessage rejects an unknown message type', () => {
  assert.throws(() => decodeMessage(JSON.stringify({ type: 'nonsense' })), /unknown tunnel message type/);
});

test('decodeMessage rejects malformed JSON', () => {
  assert.throws(() => decodeMessage('not json'));
});

test('createHelloMessage carries the protocol version, token, appSlug and mode', () => {
  const hello = createHelloMessage({ token: 'tok_abc', appSlug: 'my-app', mode: 'preview' });
  assert.equal(hello.type, MESSAGE_TYPES.HELLO);
  assert.equal(hello.version, PROTOCOL_VERSION);
  assert.equal(hello.token, 'tok_abc');
  assert.equal(hello.appSlug, 'my-app');
  assert.equal(hello.mode, 'preview');
});

test('createHelloAckMessage defaults previewUrl/sessionId to null', () => {
  const ack = createHelloAckMessage();
  assert.equal(ack.type, MESSAGE_TYPES.HELLO_ACK);
  assert.equal(ack.previewUrl, null);
  assert.equal(ack.sessionId, null);
});

test('createRequestMessage/decodeBody round-trips a binary body via base64', () => {
  const body = Buffer.from('hello world');
  const message = createRequestMessage({ id: 'r1', method: 'POST', url: '/x', headers: { a: '1' }, body });
  assert.equal(message.type, MESSAGE_TYPES.REQUEST);
  assert.notEqual(message.body, null);
  assert.deepEqual(decodeBody(message), body);
});

test('createRequestMessage/createResponseMessage tolerate a null body', () => {
  const request = createRequestMessage({ id: 'r2', method: 'GET', url: '/y' });
  assert.equal(request.body, null);
  assert.deepEqual(decodeBody(request), Buffer.alloc(0));

  const response = createResponseMessage({ id: 'r2', statusCode: 204, headers: {} });
  assert.equal(response.body, null);
});

test('createResponseMessage carries statusCode and headers', () => {
  const response = createResponseMessage({ id: 'r3', statusCode: 200, headers: { 'content-type': 'text/plain' }, body: 'hi' });
  assert.equal(response.type, MESSAGE_TYPES.RESPONSE);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'text/plain');
  assert.equal(decodeBody(response).toString('utf8'), 'hi');
});

test('createErrorMessage carries an optional id and a message', () => {
  const error = createErrorMessage({ id: 'r4', message: 'boom' });
  assert.equal(error.type, MESSAGE_TYPES.ERROR);
  assert.equal(error.id, 'r4');
  assert.equal(error.message, 'boom');

  const bare = createErrorMessage({ message: 'no id' });
  assert.equal(bare.id, null);
});

test('every message factory produces output that round-trips through encode/decode', () => {
  const messages = [
    createHelloMessage({ token: 't', appSlug: 'a', mode: 'preview' }),
    createHelloAckMessage({ previewUrl: 'https://preview.onyxpowered.com/a', sessionId: 's1' }),
    createPingMessage(),
    createPongMessage(),
    createRequestMessage({ id: '1', method: 'GET', url: '/' }),
    createResponseMessage({ id: '1', statusCode: 200, headers: {} }),
    createErrorMessage({ message: 'x' }),
  ];
  for (const message of messages) {
    assert.deepEqual(decodeMessage(encodeMessage(message)), message);
  }
});
