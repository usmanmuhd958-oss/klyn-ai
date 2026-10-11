import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import {
  canonicalizeJcs,
  dssePreAuthEncoding,
  KEL_EVIDENCE_PAYLOAD_TYPE,
  verifyDsseEnvelope,
} from "@klyn/governance";
import type {
  DsseEnvelopeV1,
  EvidenceStatementV1,
  KelAppendReceiptV1,
  VerificationReportV1,
} from "@klyn/governance";
import {
  CapabilityKelEvidenceSink,
  type CapabilityEvidenceEvent,
} from "../src/index.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const producerKeyId = "kel-producer-key-v1";
const producerKeys = new Map([[producerKeyId, publicKey]]);
const trustedContext = {
  intentDigest: "sha256:" + "1".repeat(64),
  planDigest: "sha256:" + "2".repeat(64),
  policyDigest: "sha256:" + "f".repeat(64),
  sourceTreeDigest: "sha256:" + "4".repeat(64),
  runtimeImageDigest: "sha256:" + "5".repeat(64),
};
const trustedSubject = {
  repositoryUri: "urn:klyn:mission:mission-1",
  baseRevision: "mission-revision-1",
  resultingTreeDigest: null,
  changeDigest: null,
};

const acceptedVerification: VerificationReportV1 = {
  ledgerIntegrity: "pass",
  producerAuthentication: "pass",
  inclusion: "pass",
  checkpointAuthentication: "pass",
  consistency: "pass",
  witnessQuorum: "pass",
  evidencePolicy: "pass",
  accepted: true,
  reasonCodes: [],
};

function testEvent(): CapabilityEvidenceEvent {
  const attestationPayload = Object.freeze({
    schema: "urn:klyn:capability-preexecution-attestation:v1" as const,
    invocationId: "invoke-1",
    tokenId: "token-1",
    tokenDigest: "a".repeat(64),
    principalId: "agent-a",
    missionId: "mission-1",
    runtimeInstanceId: "runtime-a",
    audience: "runtime-a",
    requestDigest: "b".repeat(64),
    scopeDigest: "c".repeat(64),
    policyDigest: "f".repeat(64),
    sandboxProfileDigest: "d".repeat(64),
    reservationId: "reservation-1",
    issuedAtEpochMs: 1500,
    expiresAtEpochMs: 3000,
  });
  const preExecutionAttestation = Object.freeze({
    payload: attestationPayload,
    signature: Object.freeze({
      algorithm: "Ed25519" as const,
      keyId: producerKeyId,
      signatureBase64: sign(null, Buffer.from(canonicalizeJcs(attestationPayload)), privateKey).toString("base64"),
    }),
  });
  return {
    schema: "urn:klyn:capability-evidence:v1",
    eventId: "event-capability-1",
    kind: "capability-invocation-authorized",
    occurredAtEpochMs: 2000,
    principalId: "agent-a",
    missionId: "mission-1",
    runtimeInstanceId: "runtime-a",
    tokenId: "token-1",
    tokenDigest: "a".repeat(64),
    parentTokenDigest: null,
    invocationId: "invoke-1",
    requestDigest: "b".repeat(64),
    policyDigest: "f".repeat(64),
    preExecutionAttestation,
    outcome: "allowed",
    reasonCode: "pre_execution_attestation_verified",
    details: {
      scopeDigest: "c".repeat(64),
      sandboxProfileDigest: "d".repeat(64),
      reservationId: "reservation-1",
    },
  };
}

function makeSink(accept = true, capture?: (statement: EvidenceStatementV1) => void): CapabilityKelEvidenceSink {
  return new CapabilityKelEvidenceSink({
    ledgerId: "kel-ledger-1",
    producerId: "trusted-runtime-producer",
    signer: {
      keyId: producerKeyId,
      async signPae(pae) {
        return sign(null, Buffer.from(pae), privateKey).toString("base64");
      },
    },
    bridge: {
      async submit(envelope: DsseEnvelopeV1, acceptedAtEpochMs: string) {
        assert.match(acceptedAtEpochMs, /^(0|[1-9][0-9]*)$/);
        const decoded = verifyDsseEnvelope(envelope, KEL_EVIDENCE_PAYLOAD_TYPE, producerKeys);
        const statement = decoded as unknown as EvidenceStatementV1;
        if (capture) capture(statement);
        const digest = "a".repeat(64);
        const receipt: KelAppendReceiptV1 = {
          ledgerId: statement.ledgerId,
          sequence: statement.sequenceInRun,
          evidenceId: statement.evidenceId,
          envelopeDigest: digest,
          leafHash: digest,
          treeSize: "1",
          rootHash: digest,
          checkpointEnvelope: envelope,
          idempotentReplay: false,
        };
        return {
          receipt,
          verification: { ...acceptedVerification, accepted: accept, reasonCodes: accept ? [] : ["witness_quorum_missing"] },
        };
      },
    },
    sequences: {
      async reserveSequence(runId, eventId) {
        assert.equal(runId, "run-1");
        assert.equal(eventId, "event-capability-1");
        return "1";
      },
    },
    runIdForEvent: () => "run-1",
    contextForEvent: async () => trustedContext,
    subjectForEvent: async () => trustedSubject,
    now: () => 2100,
  });
}

test("capability evidence is canonical DSSE and carries its authority bindings into KEL", async () => {
  let captured: EvidenceStatementV1 | undefined;
  const sink = makeSink(true, (statement) => { captured = statement; });
  const receipt = await sink.append(testEvent());
  assert.ok(captured);
  assert.equal(captured.schema, "urn:klyn:evidence:v1");
  assert.equal(captured.kind, "authorization-decision");
  assert.equal(captured.context.policyDigest, trustedContext.policyDigest);
  assert.equal(captured.extensions.tokenDigest, "a".repeat(64));
  assert.equal(captured.extensions.missionId, "mission-1");
  assert.equal(receipt.ledgerId, "kel-ledger-1");
  assert.equal(receipt.evidenceId, "event-capability-1");
  assert.match(receipt.statementDigest, /^[a-f0-9]{64}$/);
});

test("capability evidence fails closed when KEL has not accepted the statement", async () => {
  await assert.rejects(
    makeSink(false).append(testEvent()),
    /KEL did not accept capability evidence: witness_quorum_missing/,
  );
});

test("KEL adapter rejects malformed context digests before transport submission", async () => {
  const sink = new CapabilityKelEvidenceSink({
    ledgerId: "kel-ledger-1",
    producerId: "trusted-runtime-producer",
    signer: {
      keyId: producerKeyId,
      async signPae(pae) {
        return sign(null, Buffer.from(pae), privateKey).toString("base64");
      },
    },
    bridge: {
      async submit(envelope) {
        const decoded = verifyDsseEnvelope(envelope, KEL_EVIDENCE_PAYLOAD_TYPE, producerKeys);
        const statement = decoded as unknown as EvidenceStatementV1;
        const envelopePayload = Buffer.from(envelope.payload, "base64").toString("utf8");
        assert.equal(envelopePayload, canonicalizeJcs(statement));
        throw new Error("transport must not be reached for invalid context");
      },
    },
    sequences: { async reserveSequence() { return "1"; } },
    runIdForEvent: () => "run-1",
    contextForEvent: async () => ({ ...trustedContext, policyDigest: "bad-digest" }),
    subjectForEvent: async () => trustedSubject,
    now: () => 2100,
  });
  await assert.rejects(sink.append(testEvent()), /context.policyDigest must be sha256:/);
});
