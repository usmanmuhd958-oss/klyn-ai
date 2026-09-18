import { type KeyObject } from 'node:crypto';
import { AuditLedger } from './audit.js';
import type { ArtifactAttestation } from './types.js';
import { CompletionGate, EvidenceLedger } from './evidence.js';
export declare class ArtifactAttestor {
    private readonly audit;
    private readonly evidence;
    private readonly completion;
    constructor(audit: AuditLedger, evidence: EvidenceLedger, completion: CompletionGate);
    attest(manifestInput: unknown, objectiveInput: unknown, keyId: string, privateKey: KeyObject, nowEpochMs?: number): ArtifactAttestation;
    verify(attestation: ArtifactAttestation, publicKey: KeyObject): boolean;
}
//# sourceMappingURL=attestation.d.ts.map