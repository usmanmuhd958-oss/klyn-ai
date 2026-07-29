// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
// benchmark/perf_test.ts
import { KlynEngine } from '../src/engine/klyn_engine.js';
import { performance } from 'node:perf_hooks';

async function benchmark() {
  const engine = new KlynEngine();
  const testPath = process.argv[2] || './src';
  
  console.log('=== Klyn Engine Performance Benchmark ===\n');
  
  const indexStart = performance.now();
  const stats = await engine.indexRepository(testPath);
  const indexEnd = performance.now();
  
  console.log(`Index Performance:`);
  console.log(`  Total time: ${(indexEnd - indexStart).toFixed(2)} ms`);
  console.log(`  Files/sec: ${(stats.filesIndexed / ((indexEnd - indexStart) / 1000)).toFixed(2)}`);
  console.log(`  MB/sec: ${(stats.totalSize / 1024 / 1024 / ((indexEnd - indexStart) / 1000)).toFixed(2)}`);
  
  const queryEngine = engine.getQueryEngine();
  const dag = engine.getDAG();
  const testHashes = dag.getAllHashes().slice(0, 1000);
  
  const lookupStart = performance.now();
  for (const hash of testHashes) {
    dag.get(hash);
  }
  const lookupEnd = performance.now();
  
  const avgLookup = (lookupEnd - lookupStart) / testHashes.length;
  console.log(`\nLookup Performance (${testHashes.length} queries):`);
  console.log(`  Total time: ${(lookupEnd - lookupStart).toFixed(2)} ms`);
  console.log(`  Avg per lookup: ${avgLookup.toFixed(6)} ms`);
  console.log(`  Lookups/sec: ${(1000 / avgLookup).toFixed(0)}`);
  
  const memUsage = process.memoryUsage();
  console.log(`\nMemory Footprint:`);
  console.log(`  Heap used: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  RSS: ${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Per file: ${(memUsage.heapUsed / stats.filesIndexed / 1024).toFixed(2)} KB`);
}

benchmark();
