import assert from 'node:assert/strict';
import test from 'node:test';
import { PaymentRequest } from '@cashu/cashu-ts';
import { bech32m } from '@scure/base';
import { encode } from 'cborg';
import { allocate, makeDemoRequest, paymentURI, readTemplate } from '../src/payment.js';

const b64 = input => Buffer.from(encode(input)).toString('base64url');
const classic = extra => `creqA${b64({
  i: 'episode-credit', u: 'sat', s: false,
  m: ['https://testnut.cashu.space'],
  t: [{ t: 'post', a: 'https://payments.example.org/receive' }],
  ...extra,
})}`;

test('whole-sat allocation preserves totals and gives ties to the first listed recipients', () => {
  assert.deepEqual(allocate(500, [60, 25, 15]), [300, 125, 75]);
  assert.deepEqual(allocate(7, [1, 1, 1]), [3, 2, 2]);
  assert.deepEqual(allocate(1, [1, 1, 1]), [1, 0, 0]);
  for (let total = 1; total < 1400; total += 7) {
    const result = allocate(total, [99, 10, 291, 4]);
    assert.equal(result.reduce((a, b) => a + b), total);
  }
  assert.throws(() => allocate(0, [1]), /whole number/);
  assert.throws(() => allocate(14, [1, 0]), /whole split weight/);
});

test('classic request passes independent Cashu wallet codec with original routing and mint', () => {
  const raw = classic();
  const template = readTemplate(paymentURI(raw));
  const result = PaymentRequest.fromEncodedRequest(template.withAmount(73));
  assert.equal(result.amount.toNumber(), 73);
  assert.equal(result.unit, 'sat');
  assert.equal(result.id, 'episode-credit');
  assert.deepEqual(result.mints, ['https://testnut.cashu.space']);
  assert.equal(result.transport[0].target, 'https://payments.example.org/receive');
});

test('compact request passes independent Cashu wallet codec', () => {
  const bytes = new TextEncoder().encode('https://payments.example.org/receive');
  const transport = [1, 0, 1, 1, 2, 0, bytes.length, ...bytes];
  const compact = bech32m.encode('creqb', bech32m.toWords(Uint8Array.from([3, 0, 1, 0, 7, 0, transport.length, ...transport])), 4096);
  const result = PaymentRequest.fromEncodedRequest(readTemplate(compact).withAmount(243));
  assert.equal(result.amount.toNumber(), 243);
  assert.equal(result.unit, 'sat');
  assert.equal(result.transport[0].target, 'https://payments.example.org/receive');
});

test('fixed, single-use, wrong currency, unsupported delivery and demo without opt-in are rejected', () => {
  assert.throws(() => readTemplate(classic({ a: 25 })), /without an amount/);
  assert.throws(() => readTemplate(classic({ s: true })), /reusable/);
  assert.throws(() => readTemplate(classic({ u: 'usd' })), /sats/);
  assert.throws(() => readTemplate(classic({ t: [] })), /delivery/);
  assert.throws(() => readTemplate(makeDemoRequest('guest')), /public HTTPS/);
  assert.equal(readTemplate(makeDemoRequest('guest'), true).destinations[0].label, 'example.invalid');
});
