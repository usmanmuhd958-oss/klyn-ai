import { sha256, canonicalize } from './crypto.js';
import { isJsonValue, ValidationError } from './validation.js';
const GENESIS_HASH = '0'.repeat(64);
function auditEventToJson(event) {
    const normalized = JSON.parse(JSON.stringify(event));
    if (!isJsonValue(normalized))
        throw new ValidationError('audit event contains unsupported data');
    return normalized;
}
function hashRecord(sequence, previousHash, event) {
    return sha256(canonicalize({ sequence, previousHash, event: auditEventToJson(event) }));
}
export class AuditLedger {
    recordsStore = [];
    append(event) {
        const previousHash = this.recordsStore.at(-1)?.hash ?? GENESIS_HASH;
        const sequence = this.recordsStore.length + 1;
        const record = Object.freeze({ sequence, previousHash, event: deepFreeze(event), hash: hashRecord(sequence, previousHash, event) });
        this.recordsStore.push(record);
        return record;
    }
    headHash() {
        return this.recordsStore.at(-1)?.hash ?? GENESIS_HASH;
    }
    length() {
        return this.recordsStore.length;
    }
    records() {
        return Object.freeze([...this.recordsStore]);
    }
    verify() {
        let previousHash = GENESIS_HASH;
        for (let index = 0; index < this.recordsStore.length; index += 1) {
            const record = this.recordsStore[index];
            if (record === undefined)
                return false;
            if (record.sequence !== index + 1 || record.previousHash !== previousHash)
                return false;
            if (record.hash !== hashRecord(record.sequence, record.previousHash, record.event))
                return false;
            previousHash = record.hash;
        }
        return true;
    }
}
function deepFreeze(value) {
    if (typeof value !== 'object' || value === null)
        return value;
    if (Object.isFrozen(value))
        return value;
    if (Array.isArray(value)) {
        for (const child of value)
            deepFreeze(child);
    }
    else {
        for (const child of Object.values(value))
            deepFreeze(child);
    }
    return Object.freeze(value);
}
//# sourceMappingURL=audit.js.map