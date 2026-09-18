"use strict";

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = process.cwd();

const governanceRoot = path.join(
  repoRoot,
  "packages",
  "governance",
);

const sourceDir = path.join(
  governanceRoot,
  "src",
);

const testDir = path.join(
  governanceRoot,
);

const checkpointPath = path.join(
  sourceDir,
  "checkpoint.ts",
);

const checkpointTestPath = path.join(
  governanceRoot,
  "tests",
  "checkpoint.test.ts",
);

const indexPath = path.join(
  sourceDir,
  "index.ts",
);

if (
  !fs.existsSync(governanceRoot) ||
  !fs.existsSync(indexPath)
) {
  throw new Error(
    "packages/governance was not found. Run this script from the Klyn repository root.",
  );
}

fs.mkdirSync(sourceDir, { recursive: true });
fs.mkdirSync(path.join(governanceRoot, "tests"), { recursive: true });

const checkpointSource = String.raw`import {
  createHash,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";

export const AUDIT_CHECKPOINT_VERSION =
  "1.0.0" as const;

export interface AuditCheckpointPayload {
  readonly version: typeof AUDIT_CHECKPOINT_VERSION;
  readonly stateHash: string;
  readonly parentCheckpointHash: string | null;
}

export interface AuditCheckpoint
  extends AuditCheckpointPayload {
  readonly checkpointHash: string;
  readonly signatureBase64: string;
}

export interface AuditCheckpointVerification {
  readonly verified: boolean;
  readonly checkedCount: number;
  readonly failedIndex: number | null;
  readonly reason:
    | "verified"
    | "empty-chain"
    | "invalid-state-hash"
    | "invalid-parent-hash"
    | "checkpoint-hash-mismatch"
    | "parent-hash-mismatch"
    | "signature-invalid"
    | "duplicate-checkpoint-hash";
}

export interface AuditCheckpointKeyPair {
  readonly publicKey: KeyObject;
  readonly privateKey: KeyObject;
}

function isSha256Hex(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function canonicalize(
  payload: AuditCheckpointPayload,
): string {
  return JSON.stringify({
    version: payload.version,
    stateHash: payload.stateHash,
    parentCheckpointHash:
      payload.parentCheckpointHash,
  });
}

function hashPayload(
  payload: AuditCheckpointPayload,
): string {
  return createHash("sha256")
    .update(
      canonicalize(payload),
      "utf8",
    )
    .digest("hex");
}

function signCheckpointHash(
  checkpointHash: string,
  privateKey: KeyObject,
): string {
  return sign(
    null,
    Buffer.from(
      checkpointHash,
      "utf8",
    ),
    privateKey,
  ).toString("base64");
}

function verifyCheckpointSignature(
  checkpointHash: string,
  signatureBase64: string,
  publicKey: KeyObject,
): boolean {
  try {
    return verify(
      null,
      Buffer.from(
        checkpointHash,
        "utf8",
      ),
      publicKey,
      Buffer.from(
        signatureBase64,
        "base64",
      ),
    );
  } catch {
    return false;
  }
}

function freezeCheckpoint(
  checkpoint: AuditCheckpoint,
): AuditCheckpoint {
  return Object.freeze({
    ...checkpoint,
  });
}

export class AuditCheckpointEngine {
  public static generateKeyPair(): AuditCheckpointKeyPair {
    const pair =
      generateKeyPairSync("ed25519");

    return Object.freeze({
      publicKey: pair.publicKey,
      privateKey: pair.privateKey,
    });
  }

  public createCheckpoint(
    stateHash: string,
    parentCheckpointHash: string | null,
    privateKey: KeyObject,
  ): AuditCheckpoint {
    if (!isSha256Hex(stateHash)) {
      throw new Error(
        "stateHash must be a SHA-256 hexadecimal digest",
      );
    }

    if (
      parentCheckpointHash !== null &&
      !isSha256Hex(parentCheckpointHash)
    ) {
      throw new Error(
        "parentCheckpointHash must be null or a SHA-256 hexadecimal digest",
      );
    }

    const payload: AuditCheckpointPayload =
      Object.freeze({
        version:
          AUDIT_CHECKPOINT_VERSION,
        stateHash,
        parentCheckpointHash,
      });

    const checkpointHash =
      hashPayload(payload);

    const signatureBase64 =
      signCheckpointHash(
        checkpointHash,
        privateKey,
      );

    return freezeCheckpoint({
      ...payload,
      checkpointHash,
      signatureBase64,
    });
  }

  public verifyCheckpointChain(
    checkpoints: readonly AuditCheckpoint[],
    publicKey: KeyObject,
  ): AuditCheckpointVerification {
    if (
      checkpoints.length === 0
    ) {
      return Object.freeze({
        verified: false,
        checkedCount: 0,
        failedIndex: null,
        reason: "empty-chain",
      });
    }

    const seenHashes =
      new Set<string>();

    for (
      let index = 0;
      index < checkpoints.length;
      index += 1
    ) {
      const checkpoint =
        checkpoints[index];

      if (
        !checkpoint ||
        checkpoint.version !==
          AUDIT_CHECKPOINT_VERSION
      ) {
        return Object.freeze({
          verified: false,
          checkedCount: index,
          failedIndex: index,
          reason: "checkpoint-hash-mismatch",
        });
      }

      if (
        !isSha256Hex(
          checkpoint.stateHash,
        )
      ) {
        return Object.freeze({
          verified: false,
          checkedCount: index,
          failedIndex: index,
          reason: "invalid-state-hash",
        });
      }

      if (
        checkpoint.parentCheckpointHash !==
          null &&
        !isSha256Hex(
          checkpoint.parentCheckpointHash,
        )
      ) {
        return Object.freeze({
          verified: false,
          checkedCount: index,
          failedIndex: index,
          reason: "invalid-parent-hash",
        });
      }

      const payload: AuditCheckpointPayload =
        Object.freeze({
          version:
            checkpoint.version,
          stateHash:
            checkpoint.stateHash,
          parentCheckpointHash:
            checkpoint.parentCheckpointHash,
        });

      const expectedCheckpointHash =
        hashPayload(payload);

      if (
        expectedCheckpointHash !==
        checkpoint.checkpointHash
      ) {
        return Object.freeze({
          verified: false,
          checkedCount: index,
          failedIndex: index,
          reason: "checkpoint-hash-mismatch",
        });
      }

      if (
        seenHashes.has(
          checkpoint.checkpointHash,
        )
      ) {
        return Object.freeze({
          verified: false,
          checkedCount: index,
          failedIndex: index,
          reason: "duplicate-checkpoint-hash",
        });
      }

      seenHashes.add(
        checkpoint.checkpointHash,
      );

      const expectedParent =
        index === 0
          ? null
          : checkpoints[index - 1]
              ?.checkpointHash;

      if (
        checkpoint.parentCheckpointHash !==
        expectedParent
      ) {
        return Object.freeze({
          verified: false,
          checkedCount: index,
          failedIndex: index,
          reason: "parent-hash-mismatch",
        });
      }

      const signatureValid =
        verifyCheckpointSignature(
          checkpoint.checkpointHash,
          checkpoint.signatureBase64,
          publicKey,
        );

      if (!signatureValid) {
        return Object.freeze({
          verified: false,
          checkedCount: index,
          failedIndex: index,
          reason: "signature-invalid",
        });
      }
    }

    return Object.freeze({
      verified: true,
      checkedCount:
        checkpoints.length,
      failedIndex: null,
      reason: "verified",
    });
  }
}
`;

const checkpointTestSource = String.raw`import assert from "node:assert/strict";
import test from "node:test";

import {
  AuditCheckpointEngine,
  type AuditCheckpoint,
} from "../src/checkpoint.js";

const STATE_HASH_A =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const STATE_HASH_B =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const STATE_HASH_C =
  "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

test(
  "P4-04: valid single checkpoint generation and verification passes",
  () => {
    const engine =
      new AuditCheckpointEngine();

    const keys =
      AuditCheckpointEngine.generateKeyPair();

    const checkpoint =
      engine.createCheckpoint(
        STATE_HASH_A,
        null,
        keys.privateKey,
      );

    const result =
      engine.verifyCheckpointChain(
        [checkpoint],
        keys.publicKey,
      );

    assert.equal(
      result.verified,
      true,
    );

    assert.equal(
      result.reason,
      "verified",
    );

    assert.equal(
      result.checkedCount,
      1,
    );

    assert.equal(
      result.failedIndex,
      null,
    );

    assert.equal(
      checkpoint.parentCheckpointHash,
      null,
    );

    assert.equal(
      Object.isFrozen(checkpoint),
      true,
    );
  },
);

test(
  "P4-04: valid multi-checkpoint chain verifies",
  () => {
    const engine =
      new AuditCheckpointEngine();

    const keys =
      AuditCheckpointEngine.generateKeyPair();

    const first =
      engine.createCheckpoint(
        STATE_HASH_A,
        null,
        keys.privateKey,
      );

    const second =
      engine.createCheckpoint(
        STATE_HASH_B,
        first.checkpointHash,
        keys.privateKey,
      );

    const third =
      engine.createCheckpoint(
        STATE_HASH_C,
        second.checkpointHash,
        keys.privateKey,
      );

    const result =
      engine.verifyCheckpointChain(
        [first, second, third],
        keys.publicKey,
      );

    assert.equal(
      result.verified,
      true,
    );

    assert.equal(
      result.checkedCount,
      3,
    );
  },
);

test(
  "P4-05: tampered payload fails hash verification",
  () => {
    const engine =
      new AuditCheckpointEngine();

    const keys =
      AuditCheckpointEngine.generateKeyPair();

    const checkpoint =
      engine.createCheckpoint(
        STATE_HASH_A,
        null,
        keys.privateKey,
      );

    const tampered: AuditCheckpoint =
      Object.freeze({
        ...checkpoint,
        stateHash: STATE_HASH_B,
      });

    const result =
      engine.verifyCheckpointChain(
        [tampered],
        keys.publicKey,
      );

    assert.equal(
      result.verified,
      false,
    );

    assert.equal(
      result.failedIndex,
      0,
    );

    assert.equal(
      result.reason,
      "checkpoint-hash-mismatch",
    );
  },
);

test(
  "P4-05: invalid parent hash breaks the chain",
  () => {
    const engine =
      new AuditCheckpointEngine();

    const keys =
      AuditCheckpointEngine.generateKeyPair();

    const first =
      engine.createCheckpoint(
        STATE_HASH_A,
        null,
        keys.privateKey,
      );

    const second =
      engine.createCheckpoint(
        STATE_HASH_B,
        first.checkpointHash,
        keys.privateKey,
      );

    const thirdWithBrokenParent =
      Object.freeze({
        ...engine.createCheckpoint(
          STATE_HASH_C,
          second.checkpointHash,
          keys.privateKey,
        ),
        parentCheckpointHash:
          first.checkpointHash,
      });

    const result =
      engine.verifyCheckpointChain(
        [
          first,
          second,
          thirdWithBrokenParent,
        ],
        keys.publicKey,
      );

    assert.equal(
      result.verified,
      false,
    );

    assert.equal(
      result.failedIndex,
      2,
    );

    assert.equal(
      result.reason,
      "checkpoint-hash-mismatch",
    );
  },
);

test(
  "P4-05: missing parent link fails closed",
  () => {
    const engine =
      new AuditCheckpointEngine();

    const keys =
      AuditCheckpointEngine.generateKeyPair();

    const first =
      engine.createCheckpoint(
        STATE_HASH_A,
        null,
        keys.privateKey,
      );

    const second =
      engine.createCheckpoint(
        STATE_HASH_B,
        null,
        keys.privateKey,
      );

    const result =
      engine.verifyCheckpointChain(
        [first, second],
        keys.publicKey,
      );

    assert.equal(
      result.verified,
      false,
    );

    assert.equal(
      result.failedIndex,
      1,
    );

    assert.equal(
      result.reason,
      "parent-hash-mismatch",
    );
  },
);

test(
  "P4-06: corrupted Ed25519 signature fails immediately",
  () => {
    const engine =
      new AuditCheckpointEngine();

    const keys =
      AuditCheckpointEngine.generateKeyPair();

    const first =
      engine.createCheckpoint(
        STATE_HASH_A,
        null,
        keys.privateKey,
      );

    const second =
      engine.createCheckpoint(
        STATE_HASH_B,
        first.checkpointHash,
        keys.privateKey,
      );

    const corruptedSignature =
      first.signatureBase64
        .slice(0, -1) +
      (
        first.signatureBase64
          .slice(-1) === "A"
          ? "B"
          : "A"
      );

    const corrupted =
      Object.freeze({
        ...first,
        signatureBase64:
          corruptedSignature,
      });

    const result =
      engine.verifyCheckpointChain(
        [corrupted, second],
        keys.publicKey,
      );

    assert.equal(
      result.verified,
      false,
    );

    assert.equal(
      result.failedIndex,
      0,
    );

    assert.equal(
      result.checkedCount,
      0,
    );

    assert.equal(
      result.reason,
      "signature-invalid",
    );
  },
);

test(
  "P4-06: signature from another key fails",
  () => {
    const engine =
      new AuditCheckpointEngine();

    const signingKeys =
      AuditCheckpointEngine.generateKeyPair();

    const differentKeys =
      AuditCheckpointEngine.generateKeyPair();

    const checkpoint =
      engine.createCheckpoint(
        STATE_HASH_A,
        null,
        signingKeys.privateKey,
      );

    const result =
      engine.verifyCheckpointChain(
        [checkpoint],
        differentKeys.publicKey,
      );

    assert.equal(
      result.verified,
      false,
    );

    assert.equal(
      result.failedIndex,
      0,
    );

    assert.equal(
      result.reason,
      "signature-invalid",
    );
  },
);

test(
  "deterministic checkpoint identity for identical state and parent",
  () => {
    const engine =
      new AuditCheckpointEngine();

    const keys =
      AuditCheckpointEngine.generateKeyPair();

    const first =
      engine.createCheckpoint(
        STATE_HASH_A,
        null,
        keys.privateKey,
      );

    const second =
      engine.createCheckpoint(
        STATE_HASH_A,
        null,
        keys.privateKey,
      );

    assert.equal(
      first.checkpointHash,
      second.checkpointHash,
    );

    assert.equal(
      first.signatureBase64,
      second.signatureBase64,
    );
  },
);

test(
  "empty chains fail closed",
  () => {
    const engine =
      new AuditCheckpointEngine();

    const keys =
      AuditCheckpointEngine.generateKeyPair();

    const result =
      engine.verifyCheckpointChain(
        [],
        keys.publicKey,
      );

    assert.equal(
      result.verified,
      false,
    );

    assert.equal(
      result.reason,
      "empty-chain",
    );
  },
);

test(
  "invalid state hashes are rejected during creation",
  () => {
    const engine =
      new AuditCheckpointEngine();

    const keys =
      AuditCheckpointEngine.generateKeyPair();

    assert.throws(
      () =>
        engine.createCheckpoint(
          "not-a-sha256",
          null,
          keys.privateKey,
        ),
      /stateHash must be a SHA-256/,
    );
  },
);
`;

const existingIndex =
  fs.readFileSync(
    indexPath,
    "utf8",
  );

const exportBlock = [
  'export { AuditCheckpointEngine } from "./checkpoint.js";',
  "export type {",
  "  AuditCheckpoint,",
  "  AuditCheckpointKeyPair,",
  "  AuditCheckpointPayload,",
  "  AuditCheckpointVerification,",
  '} from "./checkpoint.js";',
].join("\n");

let updatedIndex =
  existingIndex;

if (
  !existingIndex.includes(
    'export { AuditCheckpointEngine } from "./checkpoint.js";',
  )
) {
  updatedIndex =
    existingIndex.trimEnd() +
    "\n\n" +
    exportBlock +
    "\n";
}

fs.writeFileSync(
  checkpointPath,
  checkpointSource,
  "utf8",
);

fs.writeFileSync(
  checkpointTestPath,
  checkpointTestSource,
  "utf8",
);

fs.writeFileSync(
  indexPath,
  updatedIndex,
  "utf8",
);

console.log("STEP 4.2 files written successfully:");
console.log(path.relative(repoRoot, checkpointPath));
console.log(path.relative(repoRoot, checkpointTestPath));
console.log(path.relative(repoRoot, indexPath));
