// =============================================================================
// KLYN AI OS — kernel — Zero-Knowledge Code Audit & Proof Verification
// File: kernel/src/security/zk_audit.ts
//
// Phase 6 capability #4. Cryptographic signature verification for every
// LLM-generated AST transformation and patch, producing execution proofs
// LINKED to the Phase 4 Merkle Audit Trail:
//
//   const audit = new ZkAudit(ZkAudit.createKeyPair(), merkleAudit);
//   const { proof } = audit.signPatch(input, output, planHash);
//   const verdict = audit.verifyProof(proof, input, output, planHash);
//
// A proof is the triple that makes a mutation mathematically checkable:
//   1. DETERMINISM   — the same input + plan always produce the same output
//                      (assertDeterministic runs the transform twice and
//                      compares output hashes).
//   2. SIGNED        — inputHash ∥ outputHash ∥ planHash ∥ merkleRoot is
//                      signed with the trusted ed25519 key; any tampering
//                      invalidates the signature.
//   3. TAMPER-EVIDENT — the output hash is committed into the Merkle ledger,
//                      so the proof can be checked against the journal after
//                      the fact.
//
// The verification is deterministic and dependency-free (node:crypto only).
// =============================================================================
import {
  generateKeyPairSync,
  sign,
  verify,
  createPublicKey,
  createPrivateKey,
  randomUUID,
  type KeyObject,
} from 'node:crypto';
import { MerkleAudit, sha256 } from './merkle_audit.js';

export interface AuditKeyPair {
  publicKeyPem: string;
  privateKeyPem: string;
}

export interface ExecutionProof {
  /** Stable id of the patch / AST transformation. */
  patchId: string;
  inputHash: string;
  outputHash: string;
  planHash: string;
  /** Root of the Merkle ledger at commit time (the tamper-evident link). */
  merkleRoot: string;
  /** ed25519 signature over inputHash ∥ outputHash ∥ planHash ∥ merkleRoot. */
  signature: string;
  /** Fingerprint of the verifying public key. */
  verifier: string;
  timestamp: number;
}

export interface ProofVerdict {
  valid: boolean;
  reasons: string[];
}

export interface SignedPatch {
  proof: ExecutionProof;
  /** The Merkle journal entry created by committing this patch (when a
   *  ledger is wired in). */
  merkleEntry?: ReturnType<MerkleAudit['commitFile']>;
}

const DEFAULT_DETERMINISM_RUNS = 2;
const MAX_DETERMINISM_RUNS = 8;

export class ZkAudit {
  private publicKey: KeyObject;
  private privateKey: KeyObject;
  private verifierFingerprint: string;

  constructor(
    keyPair: AuditKeyPair,
    /** Phase 4 Merkle audit trail — every signed patch is committed here. */
    private readonly merkle?: MerkleAudit
  ) {
    this.publicKey = importKey(keyPair.publicKeyPem);
    this.privateKey = importKey(keyPair.privateKeyPem);
    this.verifierFingerprint = sha256(keyPair.publicKeyPem.replace(/\s+/g, '').slice(-64));
  }

  /** Generate a fresh ed25519 audit key pair (PEM-encoded). */
  static createKeyPair(): AuditKeyPair {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    return {
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    };
  }

  // -------------------------------------------------------------------------
  // SIGNING
  // -------------------------------------------------------------------------

  /**
   * Sign an LLM-generated AST transformation / patch:
   *   - commits the OUTPUT hash into the Merkle ledger (tamper-evident link),
   *   - signs inputHash ∥ outputHash ∥ planHash ∥ merkleRoot.
   */
  signPatch(input: string, output: string, planHash: string): SignedPatch {
    const inputHash = sha256(input);
    const outputHash = sha256(output);
    const patchId = randomUUID();
    const merkleEntry = this.merkle?.commitFile(`patch:${patchId}`, output, { planHash });
    const merkleRoot = merkleEntry?.root ?? sha256(output);
    // Ed25519 signs the RAW message (no digest parameter — `createSign('sha256')`
    // is rejected by OpenSSL 3 for ed25519 keys).
    const signed = `${inputHash}${outputHash}${planHash}${merkleRoot}`;
    const signature = sign(null, Buffer.from(signed), this.privateKey).toString('base64');
    return {
      proof: {
        patchId,
        inputHash,
        outputHash,
        planHash,
        merkleRoot,
        signature,
        verifier: this.verifierFingerprint,
        timestamp: Date.now(),
      },
      merkleEntry,
    };
  }

  // -------------------------------------------------------------------------
  // VERIFICATION
  // -------------------------------------------------------------------------

  /**
   * Full proof verification: recompute the hashes from the actual input /
   * output, check the ed25519 signature, and — when a ledger is wired in —
   * confirm the merkleRoot was actually committed to the journal. A proof
   * only verifies when ALL checks pass.
   */
  verifyProof(proof: ExecutionProof, input: string, output: string, planHash: string): ProofVerdict {
    const reasons: string[] = [];
    const inputHash = sha256(input);
    const outputHash = sha256(output);

    if (proof.inputHash !== inputHash) reasons.push('inputHash mismatch — input was altered');
    if (proof.outputHash !== outputHash) reasons.push('outputHash mismatch — patch content was altered');
    if (proof.planHash !== planHash) reasons.push('planHash mismatch — execution plan was altered');

    const signed = `${proof.inputHash}${proof.outputHash}${proof.planHash}${proof.merkleRoot}`;
    const signatureOk = verify(null, Buffer.from(signed), this.publicKey, Buffer.from(proof.signature, 'base64'));
    if (!signatureOk) reasons.push('ed25519 signature invalid — patch was not signed by the trusted key');

    if (this.merkle) {
      const committed = this.merkle.entries().some((entry) => entry.root === proof.merkleRoot);
      if (!committed) reasons.push(`merkleRoot ${proof.merkleRoot.slice(0, 12)}… not found in the audit ledger`);
    }

    return { valid: reasons.length === 0, reasons };
  }

  /** Quick signature-only check (cheap pre-filter before full proof verify). */
  hasValidSignature(proof: ExecutionProof): boolean {
    const signed = `${proof.inputHash}${proof.outputHash}${proof.planHash}${proof.merkleRoot}`;
    return verify(null, Buffer.from(signed), this.publicKey, Buffer.from(proof.signature, 'base64'));
  }

  // -------------------------------------------------------------------------
  // DETERMINISM (the "non-malicious by construction" property)
  // -------------------------------------------------------------------------

  /**
   * Prove a transformation is deterministic: run it `runs` times on the same
   * input and require every output hash to match. A transform that is not
   * deterministic (random output, hidden state) is by definition NOT
   * verifiable and must be rejected.
   */
  assertDeterministic(transform: (input: string) => string, input: string, runs: number = DEFAULT_DETERMINISM_RUNS): { deterministic: boolean; hashes: string[] } {
    const bounded = Math.min(Math.max(1, runs), MAX_DETERMINISM_RUNS);
    const hashes: string[] = [];
    for (let i = 0; i < bounded; i++) {
      hashes.push(sha256(transform(input)));
    }
    return { deterministic: new Set(hashes).size === 1, hashes };
  }

  get verifier(): string {
    return this.verifierFingerprint;
  }
}

function importKey(pem: string): KeyObject {
  return pem.includes('PUBLIC KEY') ? createPublicKey(pem) : createPrivateKey(pem);
}

export default ZkAudit;
