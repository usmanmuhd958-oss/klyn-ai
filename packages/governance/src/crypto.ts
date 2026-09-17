import { createHash, sign, verify, type KeyObject } from 'node:crypto';
import type { JsonValue } from './types.js';
import { isJsonValue } from './validation.js';

export function canonicalize(value: JsonValue): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite number is not canonicalizable');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(',')}}`;
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function digestJson(value: JsonValue): string {
  return sha256(canonicalize(value));
}

export function signEd25519(payload: string, key: KeyObject): string {
  return sign(null, Buffer.from(payload, 'utf8'), key).toString('base64');
}

export function verifyEd25519(payload: string, signatureBase64: string, key: KeyObject): boolean {
  return verify(null, Buffer.from(payload, 'utf8'), key, Buffer.from(signatureBase64, 'base64'));
}

export function assertCanonicalizable(value: unknown): asserts value is JsonValue {
  if (!isJsonValue(value)) throw new Error('value is not valid JSON data');
}
