import { type KeyObject } from 'node:crypto';
import type { JsonValue } from './types.js';
export declare function canonicalize(value: JsonValue): string;
export declare function sha256(value: string | Uint8Array): string;
export declare function digestJson(value: JsonValue): string;
export declare function signEd25519(payload: string, key: KeyObject): string;
export declare function verifyEd25519(payload: string, signatureBase64: string, key: KeyObject): boolean;
export declare function assertCanonicalizable(value: unknown): asserts value is JsonValue;
//# sourceMappingURL=crypto.d.ts.map