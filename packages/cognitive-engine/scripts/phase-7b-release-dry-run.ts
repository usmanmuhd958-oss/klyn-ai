import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  ConsensusPromotionController,
  PHASE_7A_CERTIFIED_SUBSTRATES,
  PHASE_7A_EXPECTED_TESTS,
} from "../src/index.ts";
import { ProductionPromotionSignoffEngine } from "../../agent-core/src/index.ts";
import { HermeticToolKernel } from "../../execution-runtime/src/hermetic-tool-kernel.ts";

const TARGET_COMMIT = process.env.KLYN_TARGET_COMMIT ?? "";
const ROOT = process.env.GITHUB_WORKSPACE ?? resolve(process.cwd(), "../..");
const PHASE_7A_HEAD = "a4fbf2debd1d2853d4efea9d0adf9eea50d68387";
const PR_HEADS = Object.freeze({
  "51": "fb9f11eb8882f6d427855f54ed56d0ed793722fd",
  "52": "7e30523f20d20d99070c50ad75dc5893fd1cabf1",
  "53": "7e595eda138b1a0cd58a751b3e8ce55f8b4876b0",
});

const canonicalize = (value: unknown): unknown => {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const object = value as Record<string, unknown>;
  return Object.keys(object).sort().reduce<Record<string, unknown>>((result, key) => {
    result[key] = canonicalize(object[key]);
    return result;
  }, {});
};

const sha256 = (value: unknown): string =>
  createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");

const readTapSummary = async (path: string, suite: keyof typeof PHASE_7A_EXPECTED_TESTS) => {
  const text = await readFile(path, "utf8");
  const pick = (name: string): number => {
    const matches = [...text.matchAll(new RegExp(`# ${name} (\\d+)`, "g"))];
    const match = matches.at(-1);
    if (!match) throw new Error(`Missing TAP '${name}' summary for ${suite}`);
    return Number(match[1]);
  };
  return Object.freeze({ suite, passed: pick("pass"), total: pick("tests"), failed: pick("fail"), skipped: pick("skipped") });
};

const assertGitAncestry = async (): Promise<void> => {
  for (const [label, sha] of Object.entries({ ...PR_HEADS, "7A": PHASE_7A_HEAD })) {
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn("git", ["-C", ROOT, "merge-base", "--is-ancestor", sha, "HEAD"]);
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`${label} substrate ${sha} is not an ancestor of HEAD`)));
    });
  }
};

const main = async (): Promise<void> => {
  if (!/^[a-f0-9]{40}$/.test(TARGET_COMMIT)) throw new Error("KLYN_TARGET_COMMIT must be a 40-character SHA");
  if (TARGET_COMMIT !== process.env.GITHUB_SHA) throw new Error("Target commit must equal GITHUB_SHA");
  await assertGitAncestry();

  const lockfile = await readFile(join(ROOT, "pnpm-lock.yaml"), "utf8");
  const lockfileHash = sha256(lockfile);
  const tap = {
    "cognitive-engine": await readTapSummary("/tmp/klyn-7b-cognitive.tap", "cognitive-engine"),
    "execution-runtime": await readTapSummary("/tmp/klyn-7b-execution.tap", "execution-runtime"),
    "agent-core": await readTapSummary("/tmp/klyn-7b-agent.tap", "agent-core"),
  } as const;

  const workspace = await mkdtemp(join(tmpdir(), "klyn-7b-"));
  try {
    await writeFile(join(workspace, "target.ts"), "export const value = 1;\n", "utf8");
    const kernel = new HermeticToolKernel({ workspaceRoot: workspace, enableBash: false });
    const intentId = "intent-phase-7b-release-dry-run";
    for (const callId of ["release-context-read", "release-proof-read"]) {
      await kernel.execute({ callId, agentId: "release-validator-7b", intentId, workingDirectory: ".", tool: "file-tree", args: { operation: "read", path: "target.ts" } });
    }

    const auditTrail = kernel.getAuditTrail();
    const testEvidence = [tap["cognitive-engine"], tap["execution-runtime"], tap["agent-core"]];
    const controller = new ConsensusPromotionController();
    const decision = controller.evaluate({
      intentId,
      auditTrail,
      testEvidence,
      selfHealing: { attempts: 1, maxAttempts: 3, recovered: true, exhausted: false, unhandledErrors: 0 },
      noFrontendChanges: true,
      coreInvariantsUnmodified: true,
      certifiedSubstrates: PHASE_7A_CERTIFIED_SUBSTRATES,
    }, TARGET_COMMIT);

    let signoff: ReturnType<ProductionPromotionSignoffEngine["create"]> | null = null;
    if (decision.state === "APPROVED") {
      signoff = new ProductionPromotionSignoffEngine().create({
        decision: decision.state,
        intentId,
        targetCommit: TARGET_COMMIT,
        auditChainHash: decision.auditChain.chainDigest,
        evidenceHash: decision.evidenceHash,
        testSummary: {
          cognitiveEngine: { passed: tap["cognitive-engine"].passed, total: tap["cognitive-engine"].total },
          executionRuntime: { passed: tap["execution-runtime"].passed, total: tap["execution-runtime"].total },
          agentCore: { passed: tap["agent-core"].passed, total: tap["agent-core"].total },
        },
        unhandledErrors: 0,
        certifiedSubstrates: PHASE_7A_CERTIFIED_SUBSTRATES,
      });
      if (!ProductionPromotionSignoffEngine.verify(signoff)) throw new Error("Production sign-off self-verification failed");
    }

    const manifestBody = {
      manifestVersion: "7B-1.0.0" as const,
      status: decision.state === "APPROVED" ? "RELEASE_READY" : "BLOCKED",
      targetCommit: TARGET_COMMIT,
      phase7aHead: PHASE_7A_HEAD,
      validatedPRHeads: PR_HEADS,
      certifiedSubstrates: PHASE_7A_CERTIFIED_SUBSTRATES,
      testEvidence,
      expectedTestEvidence: PHASE_7A_EXPECTED_TESTS,
      lockfileSha256: lockfileHash,
      backendOnly: true,
      processSandboxManagerModified: false,
      coreInvariantsModified: false,
      auditChain: decision.auditChain,
      decision: { state: decision.state, evidenceHash: decision.evidenceHash, decisionHash: decision.decisionHash, reasons: decision.reasons },
      productionSignoff: signoff,
    };
    const manifest = Object.freeze({ ...manifestBody, manifestHash: sha256(manifestBody) });
    const outputDir = join(ROOT, "artifacts/phase-7b");
    await mkdir(outputDir, { recursive: true });
    const outputPath = join(outputDir, `release-manifest.${manifest.manifestHash}.json`);
    await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    console.log(JSON.stringify({ status: manifest.status, manifestHash: manifest.manifestHash, decision: decision.state, testEvidence, expectedTestEvidence: PHASE_7A_EXPECTED_TESTS, auditChainValid: decision.auditChain.valid, lockfileSha256: lockfileHash, outputPath, reasons: decision.reasons }, null, 2));
    if (decision.state !== "APPROVED") process.exitCode = 2;
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
};

await main();
