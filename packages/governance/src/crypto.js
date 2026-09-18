import { createHash, sign, verify } from 'node:crypto';
import { isJsonValue } from './validation.js';
export function canonicalize(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean')
        return JSON.stringify(value);
    if (typeof value === 'number') {
        if (!Number.isFinite(value))
            throw new Error('non-finite number is not canonicalizable');
        return JSON.stringify(value);
    }
    if (Array.isArray(value))
        return `[${value.map(canonicalize).join(',')}]`;
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(',')}}`;
}
export function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}
export function digestJson(value) {
    return sha256(canonicalize(value));
}
export function signEd25519(payload, key) {
    return sign(null, Buffer.from(payload, 'utf8'), key).toString('base64');
}
export function verifyEd25519(payload, signatureBase64, key) {
    return verify(null, Buffer.from(payload, 'utf8'), key, Buffer.from(signatureBase64, 'base64'));
}
export function assertCanonicalizable(value) {
    if (!isJsonValue(value))
        throw new Error('value is not valid JSON data');
}
//# sourceMappingURL=crypto.js.map