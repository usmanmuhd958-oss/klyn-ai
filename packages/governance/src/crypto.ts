import { createHash, sign, verify, type KeyObject } from 'node:crypto';
import type { JsonValue } from './types.js';
import { isJsonValue } from './validation.js';

export function canonicalize(obj: any): any {
  if (obj === null || obj === undefined) {
    return null;
  }
  if (typeof obj !== "object") {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(canonicalize);
  }
  const sorted: Record<string, any> = {};
  for (const key of Object.keys(obj).sort()) {
    const val = obj[key];
    if (val !== undefined) {
      sorted[key] = canonicalize(val);
    }
  }
  return sorted;
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
