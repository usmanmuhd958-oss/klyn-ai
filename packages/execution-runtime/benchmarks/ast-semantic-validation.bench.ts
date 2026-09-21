import { strict as assert } from "node:assert";
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import { AstMutationEngine } from "../src/index.ts";

interface BenchmarkCase {
  readonly name: string;
  readonly targetBytes: number;
  readonly budgetP95Ms: number;
}

interface BenchmarkResult {
  readonly name: string;
  readonly sourceBytes: number;
  readonly lines: number;
  readonly samples: number;
  readonly warmups: number;
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  readonly budgetP95Ms: number;
}

const CASES: readonly BenchmarkCase[] = [
  { name: "large-256k", targetBytes: 256 * 1024, budgetP95Ms: Number(process.env.KLYN_AST_BENCH_256K_P95_MS ?? 2000) },
  { name: "large-1m", targetBytes: 1024 * 1024, budgetP95Ms: Number(process.env.KLYN_AST_BENCH_1M_P95_MS ?? 6000) },
  { name: "large-2m", targetBytes: 2 * 1024 * 1024, budgetP95Ms: Number(process.env.KLYN_AST_BENCH_2M_P95_MS ?? 12000) },
];

const SAMPLES = Number(process.env.KLYN_AST_BENCH_SAMPLES ?? 5);
const WARMUPS = Number(process.env.KLYN_AST_BENCH_WARMUPS ?? 1);
assert(Number.isInteger(SAMPLES) && SAMPLES >= 3, "KLYN_AST_BENCH_SAMPLES must be an integer >= 3");
assert(Number.isInteger(WARMUPS) && WARMUPS >= 0, "KLYN_AST_BENCH_WARMUPS must be an integer >= 0");

function buildSource(targetBytes: number): string {
  const chunks: string[] = ["export const targetValue = 1;\n"];
  let currentBytes = Buffer.byteLength(chunks[0], "utf8");
  let index = 0;
  while (currentBytes < targetBytes) {
    const chunk =
      "export function compute_" + index + "(value_" + index + ": number): number {\n" +
      "  const local_" + index + ": number = value_" + index + " + targetValue;\n" +
      "  return local_" + index + ";\n" +
      "}\n";
    chunks.push(chunk);
    currentBytes += Buffer.byteLength(chunk, "utf8");
    index += 1;
  }
  return chunks.join("");
}

function percentile(values: readonly number[], p: number): number {
  const ordered = [...values].sort((a, b) => a - b);
  const position = Math.max(0, Math.ceil(p * ordered.length) - 1);
  return ordered[position]!;
}

function runCase(testCase: BenchmarkCase): BenchmarkResult {
  const source = buildSource(testCase.targetBytes);
  const engine = new AstMutationEngine();
  for (let warmup = 0; warmup < WARMUPS; warmup += 1) {
    const result = engine.apply("benchmark.ts", source, [{ kind: "rename-identifier", from: "targetValue", to: "resultValue" }]);
    assert.equal(result.changed, true);
  }
  const durations: number[] = [];
  for (let sample = 0; sample < SAMPLES; sample += 1) {
    const started = performance.now();
    const result = engine.apply("benchmark.ts", source, [{ kind: "rename-identifier", from: "targetValue", to: "resultValue" }]);
    durations.push(performance.now() - started);
    assert.equal(result.changed, true);
    assert(result.source.includes("resultValue"));
    assert(!result.source.includes("const targetValue"));
  }
  const meanMs = durations.reduce((sum, value) => sum + value, 0) / durations.length;
  const p50Ms = percentile(durations, 0.50);
  const p95Ms = percentile(durations, 0.95);
  const maxMs = Math.max(...durations);
  const result: BenchmarkResult = { name: testCase.name, sourceBytes: Buffer.byteLength(source, "utf8"), lines: source.split("\n").length - 1, samples: SAMPLES, warmups: WARMUPS, meanMs, p50Ms, p95Ms, maxMs, budgetP95Ms: testCase.budgetP95Ms };
  console.log(JSON.stringify({ ...result, meanMs: Number(meanMs.toFixed(2)), p50Ms: Number(p50Ms.toFixed(2)), p95Ms: Number(p95Ms.toFixed(2)), maxMs: Number(maxMs.toFixed(2)) }));
  assert(Number.isFinite(p95Ms) && p95Ms <= testCase.budgetP95Ms, testCase.name + " exceeded p95 budget: " + p95Ms.toFixed(2) + "ms > " + testCase.budgetP95Ms + "ms");
  return result;
}

const results = CASES.map(runCase);
const outputPath = process.env.KLYN_AST_BENCH_OUTPUT;
if (outputPath) {
  writeFileSync(outputPath, JSON.stringify({ runtime: process.version, platform: process.platform, arch: process.arch, results }, null, 2) + "\n", "utf8");
}
console.log("AST semantic-validation benchmark: PASS");