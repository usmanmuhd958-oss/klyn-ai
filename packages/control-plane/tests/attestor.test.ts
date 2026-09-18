import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { Ed25519EvidenceVerifier } from "@klyn/mission-engine";
import { Ed25519MissionEvidenceAttestor } from "../src/MissionController.js";
import type { MissionEvidenceDraft } from "../src/types.js";

test("control-plane mission attestor remains compatible with Ed25519 mission verifier", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const attestor = new Ed25519MissionEvidenceAttestor("verifier-1", privateKey);
  const draft: MissionEvidenceDraft = {
    evidenceId: "evidence-1",
    missionId: "mission-1",
    objectiveId: "objective-1",
    nodeId: "node-action",
    kind: "action-receipt",
    statement: "action executed",
    invariantIds: [],
    predecessorEvidenceIds: [],
    issuedAtEpochMs: 1,
    verifierId: "verifier-1",
  };

  const evidence = attestor.attest(draft);
  const verifier = new Ed25519EvidenceVerifier("verifier-1", publicKey);

  assert.equal(verifier.verify(evidence), true);
});
