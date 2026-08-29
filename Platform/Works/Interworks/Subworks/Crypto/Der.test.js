// SDK
// Designed & Built By onyxpowered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeLength,
  encodeTlv,
  encodeSequence,
  encodeSet,
  encodeSetOf,
  encodeBoolean,
  encodeNull,
  encodeInteger,
  encodeBitString,
  encodeOctetString,
  encodeUtf8String,
  encodePrintableString,
  encodeIa5String,
  encodeOid,
  encodeUtcTime,
  encodeGeneralizedTime,
  encodeX509Time,
  encodeContextConstructed,
  encodeContextPrimitive,
  decodeTlv,
  decodeSequence,
  decodeInteger,
} from './Der.js';

test('encodeLength uses short form under 128 and long form at/above 128', () => {
  assert.deepEqual([...encodeLength(0)], [0x00]);
  assert.deepEqual([...encodeLength(127)], [0x7f]);
  assert.deepEqual([...encodeLength(128)], [0x81, 0x80]);
  assert.deepEqual([...encodeLength(300)], [0x82, 0x01, 0x2c]);
});

test('encodeTlv wraps content with a tag and length', () => {
  const tlv = encodeTlv(0x04, Buffer.from([1, 2, 3]));
  assert.deepEqual([...tlv], [0x04, 0x03, 1, 2, 3]);
});

test('encodeInteger produces a minimal two-s-complement-safe positive integer', () => {
  assert.deepEqual([...encodeInteger(0)], [0x02, 0x01, 0x00]);
  assert.deepEqual([...encodeInteger(1)], [0x02, 0x01, 0x01]);
  assert.deepEqual([...encodeInteger(127)], [0x02, 0x01, 0x7f]);
  assert.deepEqual([...encodeInteger(128)], [0x02, 0x02, 0x00, 0x80]);
  assert.deepEqual([...encodeInteger(256)], [0x02, 0x02, 0x01, 0x00]);
  assert.deepEqual([...encodeInteger(65535)], [0x02, 0x03, 0x00, 0xff, 0xff]);
});

test('encodeInteger accepts a bigint and a raw magnitude buffer', () => {
  assert.deepEqual([...encodeInteger(300n)], [...encodeInteger(300)]);
  assert.deepEqual([...encodeInteger(Buffer.from([0x00, 0x00, 0x7f]))], [0x02, 0x01, 0x7f]);
  assert.throws(() => encodeInteger(-1));
});

test('encodeOid matches the known DER encoding for sha256WithRSAEncryption', () => {
  const oid = encodeOid('1.2.840.113549.1.1.11');
  assert.deepEqual(
    [...oid],
    [0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b],
  );
});

test('encodeOid matches the known DER encoding for ecdsa-with-SHA256', () => {
  const oid = encodeOid('1.2.840.10045.4.3.2');
  assert.deepEqual([...oid], [0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]);
});

test('encodeBitString prepends the unused-bits count', () => {
  const bitString = encodeBitString(Buffer.from([0xab]), 3);
  assert.deepEqual([...bitString], [0x03, 0x02, 0x03, 0xab]);
});

test('encodeOctetString, encodeUtf8String, encodePrintableString, encodeIa5String tag correctly', () => {
  assert.equal(encodeOctetString(Buffer.from([1]))[0], 0x04);
  assert.equal(encodeUtf8String('a')[0], 0x0c);
  assert.equal(encodePrintableString('a')[0], 0x13);
  assert.equal(encodeIa5String('a')[0], 0x16);
});

test('encodeBoolean and encodeNull produce the expected fixed-size TLVs', () => {
  assert.deepEqual([...encodeBoolean(true)], [0x01, 0x01, 0xff]);
  assert.deepEqual([...encodeBoolean(false)], [0x01, 0x01, 0x00]);
  assert.deepEqual([...encodeNull()], [0x05, 0x00]);
});

test('encodeSequence and encodeSet concatenate children under the group tag', () => {
  const seq = encodeSequence(encodeInteger(1), encodeInteger(2));
  assert.deepEqual([...seq], [0x30, 0x06, ...encodeInteger(1), ...encodeInteger(2)]);
  const set = encodeSet(encodeBoolean(true));
  assert.equal(set[0], 0x31);
});

test('encodeSetOf sorts its DER-encoded children (DER canonical SET OF ordering)', () => {
  const a = encodeInteger(5);
  const b = encodeInteger(1);
  const result = encodeSetOf([a, b]);
  const expectedContent = Buffer.concat([b, a].sort(Buffer.compare));
  assert.deepEqual([...result], [0x31, expectedContent.length, ...expectedContent]);
});

test('encodeUtcTime and encodeGeneralizedTime format per X.680/X.509', () => {
  const date = new Date(Date.UTC(2026, 7, 18, 10, 5, 41));
  assert.equal(encodeUtcTime(date).subarray(2).toString('ascii'), '260818100541Z');
  assert.equal(encodeGeneralizedTime(date).subarray(2).toString('ascii'), '20260818100541Z');
});

test('encodeX509Time picks UTCTime before 2050 and GeneralizedTime at/after', () => {
  assert.equal(encodeX509Time(new Date(Date.UTC(2026, 0, 1)))[0], 0x17);
  assert.equal(encodeX509Time(new Date(Date.UTC(2050, 0, 1)))[0], 0x18);
});

test('encodeContextConstructed and encodeContextPrimitive tag with the class/context bits', () => {
  assert.equal(encodeContextConstructed(0, encodeInteger(1))[0], 0xa0);
  assert.equal(encodeContextPrimitive(2, Buffer.from('x'))[0], 0x82);
});

test('decodeTlv/decodeSequence/decodeInteger round-trip encoded structures', () => {
  const encoded = encodeSequence(encodeInteger(7), encodeOctetString(Buffer.from('hi')));
  const items = decodeSequence(encoded);
  assert.equal(items.length, 2);
  assert.equal(items[0].tag, 0x02);
  assert.equal(decodeInteger(items[0].content), 7n);
  assert.equal(items[1].tag, 0x04);
  assert.equal(items[1].content.toString('utf8'), 'hi');

  const single = decodeTlv(encodeInteger(9));
  assert.equal(single.tag, 0x02);
  assert.equal(decodeInteger(single.content), 9n);
  assert.equal(single.nextOffset, encodeInteger(9).length);
});
