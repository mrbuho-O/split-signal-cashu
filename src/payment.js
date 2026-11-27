import { bech32, bech32m } from '@scure/base';
import { decode, encode } from 'cborg';

export const MAX_TOTAL = 10_000_000;
export const MAX_WEIGHT = 100_000;
export const MAX_RECIPIENTS = 12;
export const REQUEST_MAX = 4096;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

function toBase64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64(value) {
  if (!/^[a-zA-Z0-9+/_-]+={0,2}$/.test(value)) throw new Error('Invalid Cashu request encoding.');
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
}

function parseTLV(bytes) {
  const items = [];
  for (let offset = 0; offset < bytes.length;) {
    if (bytes.length - offset < 3) throw new Error('Incomplete Cashu request field.');
    const tag = bytes[offset];
    const length = bytes[offset + 1] * 256 + bytes[offset + 2];
    offset += 3;
    if (length > bytes.length - offset) throw new Error('Incomplete Cashu request value.');
    items.push([tag, bytes.subarray(offset, offset + length)]);
    offset += length;
  }
  return items;
}

function encodeTLV(items) {
  const bytes = new Uint8Array(items.reduce((length, [, value]) => length + 3 + value.length, 0));
  let offset = 0;
  for (const [tag, value] of items) {
    bytes.set([tag, value.length >>> 8, value.length & 255], offset);
    bytes.set(value, offset + 3);
    offset += 3 + value.length;
  }
  return bytes;
}

function one(items, tag) {
  const matching = items.filter(([key]) => key === tag);
  if (matching.length > 1) throw new Error('This Cashu request repeats a field.');
  return matching[0]?.[1];
}

function postDestination(target, demo) {
  const url = new URL(target);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (!demo && url.hostname.endsWith('.invalid'))) {
    throw new Error('The Cashu request needs a public HTTPS delivery address.');
  }
  return { kind: 'HTTPS', label: url.host };
}

function nostrDestination(target) {
  const { prefix, words } = bech32.decode(target, REQUEST_MAX);
  const bytes = Uint8Array.from(bech32.fromWords(words));
  if (prefix === 'npub' && bytes.length === 32) return { kind: 'Nostr', label: `${target.slice(0, 13)}…${target.slice(-6)}` };
  if (prefix === 'nprofile') {
    for (let offset = 0; offset + 2 <= bytes.length;) {
      const type = bytes[offset];
      const length = bytes[offset + 1];
      const end = offset + 2 + length;
      if (end > bytes.length) break;
      if (type === 0 && length === 32) return { kind: 'Nostr', label: `${target.slice(0, 13)}…${target.slice(-6)}` };
      offset = end;
    }
  }
  throw new Error('The Cashu request has an invalid Nostr recipient.');
}

function unwrapRequest(value) {
  const request = value.trim();
  if (request.length > REQUEST_MAX || !request) throw new Error('Paste a Cashu payment request.');
  if (/^bitcoin:/i.test(request)) {
    const creq = new URL(request).searchParams.get('creq');
    if (creq) return creq;
  }
  return request.replace(/^cashu:(?:\/\/)?/i, '');
}

function assertTemplate(fixed, unit, once, destinations) {
  if (fixed) throw new Error('Create a request without an amount so listeners can choose their boost.');
  if (unit !== 'sat') throw new Error('Use a request denominated in sats.');
  if (once) throw new Error('Create a reusable request so more than one listener can pay it.');
  if (!destinations.length) throw new Error('Use a request with Nostr or HTTPS delivery.');
}

function readClassic(request, demo) {
  const payload = decode(fromBase64(request.slice(5)), { useMaps: true, rejectDuplicateMapKeys: true });
  if (!(payload instanceof Map)) throw new Error('Invalid Cashu request fields.');
  const transports = payload.get('t') ?? [];
  if (!Array.isArray(transports)) throw new Error('Invalid Cashu delivery options.');
  const destinations = transports.flatMap(transport => {
    if (!(transport instanceof Map)) throw new Error('Invalid Cashu delivery option.');
    if (transport.get('t') === 'nostr') return [nostrDestination(transport.get('a'))];
    if (transport.get('t') === 'post') return [postDestination(transport.get('a'), demo)];
    return [];
  });
  assertTemplate(payload.has('a'), payload.get('u') ?? 'sat', payload.get('s') === true, destinations);
  const mints = payload.get('m') ?? [];
  if (!Array.isArray(mints) || !mints.every(url => typeof url === 'string')) throw new Error('Invalid Cashu mint list.');
  return {
    destinations,
    mints,
    mintPreferred: payload.get('mp') === true,
    withAmount(amount) {
      const adjusted = new Map(payload);
      adjusted.set('a', amount);
      adjusted.set('u', 'sat');
      return `creqA${toBase64Url(encode(adjusted))}`;
    },
  };
}

function readCompact(request, demo) {
  const { prefix, words } = bech32m.decode(request, REQUEST_MAX);
  if (prefix !== 'creqb') throw new Error('Invalid compact Cashu request.');
  const fields = parseTLV(Uint8Array.from(bech32m.fromWords(words)));
  const unit = one(fields, 3);
  const sat = !unit || (unit.length === 1 && unit[0] === 0) || textDecoder.decode(unit) === 'sat';
  const destinations = fields.filter(([tag]) => tag === 7).flatMap(([, value]) => {
    const properties = parseTLV(value);
    const kind = one(properties, 1);
    const target = one(properties, 2);
    if (kind?.length !== 1 || !target?.length) throw new Error('Invalid Cashu delivery option.');
    if (kind[0] === 1) return [postDestination(textDecoder.decode(target), demo)];
    if (kind[0] === 0 && target.length === 32) return [nostrDestination(bech32.encode('npub', bech32.toWords(target)))];
    if (kind[0] === 0) throw new Error('Invalid Nostr delivery key.');
    return [];
  });
  assertTemplate(one(fields, 2), sat ? 'sat' : '', one(fields, 4)?.[0] === 1, destinations);
  return {
    destinations,
    mints: fields.filter(([tag]) => tag === 5).map(([, bytes]) => textDecoder.decode(bytes)),
    mintPreferred: one(fields, 9)?.[0] === 1,
    withAmount(amount) {
      const bytes = new Uint8Array(8);
      new DataView(bytes.buffer).setBigUint64(0, BigInt(amount));
      const entries = [...fields, [2, bytes]];
      if (!unit) entries.push([3, Uint8Array.of(0)]);
      return bech32m.encode('creqb', bech32m.toWords(encodeTLV(entries)), REQUEST_MAX).toUpperCase();
    },
  };
}

export function readTemplate(value, demo = false) {
  if (typeof value !== 'string') throw new Error('Paste a Cashu payment request.');
  const request = unwrapRequest(value);
  if (/^creqA/i.test(request)) return readClassic(request, demo);
  if (/^creqb1/i.test(request)) return readCompact(request, demo);
  throw new Error('Enter a Cashu request starting with creqA or CREQB1.');
}

export function makeDemoRequest(id) {
  const bytes = encode({ i: `demo-${id}`, u: 'sat', s: false, t: [{ t: 'post', a: `https://example.invalid/${id}` }] });
  return `creqA${toBase64Url(bytes)}`;
}

export function allocate(total, weights) {
  if (!Number.isInteger(total) || total < 1 || total > MAX_TOTAL) throw new Error('Choose a whole number of sats from 1 to 10,000,000.');
  if (!Array.isArray(weights) || !weights.length || weights.length > MAX_RECIPIENTS || weights.some(weight => !Number.isInteger(weight) || weight < 1 || weight > MAX_WEIGHT)) {
    throw new Error('Give each recipient a whole split weight from 1 to 100,000.');
  }
  const denominator = weights.reduce((sum, weight) => sum + weight, 0);
  const shares = weights.map((weight, index) => {
    const numerator = weight * total;
    return { index, sats: Math.floor(numerator / denominator), remainder: numerator % denominator };
  });
  const extras = total - shares.reduce((sum, share) => sum + share.sats, 0);
  const priority = [...shares].sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  for (const share of priority.slice(0, extras)) share.sats += 1;
  return shares.map(share => share.sats);
}

export function paymentURI(request) {
  return `bitcoin:?creq=${encodeURIComponent(request)}`;
}
