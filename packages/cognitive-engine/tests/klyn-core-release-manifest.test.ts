import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import {
  BenchmarkRunner,
  KlynCoreReleaseManifestCompiler,
  Ed25519CoreReleaseSigner,
  KLYN_CORE_PLANE_CONTRACTS,
  type CoreReleaseSigner,
  type PromotionSigner,
} from "../src/index.js";

const EXECUTION_TIMESTAMP = 1_800_000_000_000;

const promotionSigner: PromotionSigner = Object.freeze({
  algorithm: "ed25519",
  sign(payload: Buffer): string {
    return createHash("sha256").update(payload).digest("base64");
  },
  verify(payload: Buffer, signature: string): boolean {
    return createHash("sha256").update(payload).digest("base64") === signature;
  },
});

function createReleaseSigner(): CoreReleaseSigner {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return new Ed25519CoreReleaseSigner(privateKey, publicKey);
}

test("compiles a frozen Core 1.0 release manifest anchored to all five planes", async () => {
  const runner = new BenchmarkRunner({ signer: promotionSigner, executionTimestampMs: EXECUTION_TIMESTAMP });
  const benchmarkRun = await runner.runSuite();
  const signer = createReleaseSigner();
  const compiler = new KlynCoreReleaseManifestCompiler();

  const manifest = compiler.compile({
    benchmarkRun,
    planeContracts: KLYN_CORE_PLANE_CONTRACTS,
    oracleOutcomeAccuracy: 1,
    signer,
  });

  assert.equal(manifest.coreVersion, "1.0.0");
  assert.equal(Object.keys(manifest.planeContractHashes).length, 5);
  assert.equal(manifest.auditHashChain.length, 4);
  assert.equal(manifest.suiteHash, benchmarkRun.suiteHash);
  assert.equal(manifest.benchmarkRunHash, benchmarkRun.runHash);
  assert.equal(manifest.benchmarkMetrics.oracleOutcomeAccuracy, 1);
  assert.equal(Object.isFrozen(manifest), true);
  assert.equal(Object.isFrozen(manifest.auditHashChain), true);
  assert.equal(compiler.verify(manifest, signer), true);

  for (const hash of Object.values(manifest.planeContractHashes)) assert.match(hash, /^[a-f0-9]{64}$/);
  for (const entry of manifest.auditHashChain) {
    assert.match(entry.intentHash, /^[a-f0-9]{64}$/);
    assert.match(entry.cognitionHash, /^[a-f0-9]{64}$/);
    assert.match(entry.executionHash, /^[a-f0-9]{64}$/);
    assert.match(entry.evidenceHash, /^[a-f0-9]{64}$/);
    assert.match(entry.governanceHash, /^[a-f0-9]{64}$/);
    assert.match(entry.chainHash, /^[a-f0-9]{64}$/);
  }
});

test("release compilation is deterministic for the same benchmark run and signing key", async () => {
  const runner = new BenchmarkRunner({ signer: promotionSigner, executionTimestampMs: EXECUTION_TIMESTAMP });
  const benchmarkRun = await runner.runSuite();
  const signer = createReleaseSigner();
  const compiler = new KlynCoreReleaseManifestCompiler();
  const input = { benchmarkRun, planeContracts: KLYN_CORE_PLANE_CONTRACTS, oracleOutcomeAccuracy: 1, signer };

  const first = compiler.compile(input);
  const second = compiler.compile(input);

  assert.equal(first.manifestHash, second.manifestHash);
  assert.equal(first.signature, second.signature);
  assert.deepEqual(first.auditHashChain, second.auditHashChain);
});

test("release verification detects tampering", async () => {
  const runner = new BenchmarkRunner({ signer: promotionSigner, executionTimestampMs: EXECUTION_TIMESTAMP });
  const benchmarkRun = await runner.runSuite();
  const signer = createReleaseSigner();
  const compiler = new KlynCoreReleaseManifestCompiler();
  const manifest = compiler.compile({ benchmarkRun, planeContracts: KLYN_CORE_PLANE_CONTRACTS, oracleOutcomeAccuracy: 1, signer });

  const tampered = {
    ...manifest,
    benchmarkMetrics: {
      ...manifest.benchmarkMetrics,
      oracleOutcomeAccuracy: 0.5,
    },
  };

  assert.equal(compiler.verify(tampered, signer), false);
});

test("release compiler rejects invalid plane contract hashes", async () => {
  const runner = new BenchmarkRunner({ signer: promotionSigner, executionTimestampMs: EXECUTION_TIMESTAMP });
  const benchmarkRun = await runner.runSuite();
  const signer = createReleaseSigner();
  const compiler = new KlynCoreReleaseManifestCompiler();
  const invalidContracts = KLYN_CORE_PLANE_CONTRACTS.map((contract, index) =>
    index === 0 ? { ...contract, contractHash: "0".repeat(64) } : contract,
  );

  assert.throws(
    () => compiler.compile({ benchmarkRun, planeContracts: invalidContracts, oracleOutcomeAccuracy: 1, signer }),
    /Contract hash mismatch for INTENT/,
  );
});
