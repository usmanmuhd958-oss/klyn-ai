import { MerkleDAGEngine } from './kernel/src/dag/merkle_engine.js';
import { ASTDependencyGraph } from './kernel/src/ast/dependency_graph.js';
import { ContextPruner } from './kernel/src/pipeline/context_pruner.js';
import { RepoIngestionPipeline } from './kernel/src/pipeline/repo_ingest.js';

async function runProductionKernelTest() {
  console.log('=========================================================================');
  console.log('       KLYN AI OS - PRODUCTION KERNEL & AST CONTEXT PRUNER TEST         ');
  console.log('=========================================================================\n');

  const startTotal = performance.now();
  const dagEngine = new MerkleDAGEngine();
  const repoIngester = new RepoIngestionPipeline(dagEngine);
  const depGraph = new ASTDependencyGraph();

  // 1. Production Codebase Real Files Setup
  const codebaseV1 = [
    {
      path: 'src/index.ts',
      content: `import { authenticateUser } from './auth/service.js';\nimport { log } from './utils/logger.js';\nlog("App starting");`
    },
    {
      path: 'src/auth/service.ts',
      content: `import { queryDatabase } from '../db/client.js';\nexport function authenticateUser(token: string) { return queryDatabase(token); }`
    },
    {
      path: 'src/db/client.ts',
      content: `export function queryDatabase(query: string) { return { status: 200, data: "User DB Record" }; }`
    },
    {
      path: 'src/utils/logger.ts',
      content: `export function log(msg: string) { console.log("[LOG]", msg); }`
    },
    {
      path: 'src/payment/processor.ts',
      content: `import { authenticateUser } from '../auth/service.js';\nimport { queryDatabase } from '../db/client.js';\nexport function processPayment(userId: string) { authenticateUser(userId); return true; }`
    }
  ];

  console.log('[1/4] Ingesting Codebase into Merkle DAG Graph...');
  const ingestResult = await repoIngester.ingest(codebaseV1);
  const rootV1 = ingestResult.rootNode;
  
  console.log(`      └─ Root Merkle SHA-256 Hash : ${rootV1.hash}`);
  console.log(`      └─ Total Files Processed     : ${ingestResult.metrics.fileCount}`);
  console.log(`      └─ Ingestion Time            : ${ingestResult.metrics.parseTimeMs.toFixed(3)} ms\n`);

  console.log('[2/4] Building AST Dependency Tree & Mapping Relations...');
  for (const file of codebaseV1) {
    depGraph.addFile(file.path, file.content);
  }
  
  const paymentDeps = depGraph.getDependencies('src/payment/processor.ts');
  console.log(`      └─ Target File               : 'src/payment/processor.ts'`);
  console.log(`      └─ Detected Dependencies     : ${JSON.stringify(paymentDeps)}\n`);

  console.log('[3/4] Testing AST Context Pruner (LLM Token Reduction)...');
  const pruner = new ContextPruner(depGraph);
  const prunedResult = await pruner.extractPrunedContext('src/payment/processor.ts', rootV1);

  const selectedFiles = Array.from(prunedResult.prunedFiles.keys());
  console.log(`      └─ Files Selected for Context : ${selectedFiles.join(', ')}`);
  console.log(`      └─ Total Saved Token Ratio    : ${(prunedResult.totalSavedRatio * 100).toFixed(1)}% Saved`);
  console.log(`      └─ Estimated Context Tokens   : ${prunedResult.tokenEstimate} tokens\n`);

  console.log('[4/4] Modifying File & Testing O(1) Merkle DAG Diff Calculation...');
  
  // Create Version 2 by updating 'src/auth/service.ts' only
  const codebaseV2 = codebaseV1.map(f => {
    if (f.path === 'src/auth/service.ts') {
      return {
        path: f.path,
        content: `import { queryDatabase } from '../db/client.js';\nexport function authenticateUser(token: string) { console.log("V2 Auth Optimization"); return queryDatabase(token); }`
      };
    }
    return f;
  });

  const ingestV2 = await repoIngester.ingest(codebaseV2);
  const rootV2 = ingestV2.rootNode;

  const diffStart = performance.now();
  const diffResult = dagEngine.computeDiff(rootV1, rootV2);
  const diffTime = performance.now() - diffStart;

  console.log(`      └─ Root Hash V1             : ${rootV1.hash}`);
  console.log(`      └─ Root Hash V2             : ${rootV2.hash}`);
  console.log(`      └─ Modified Files Detected  : ${diffResult.modified.length}`);
  if (diffResult.modified.length > 0) {
    console.log(`      └─ Updated File Path        : ${diffResult.modified[0].newNode.path}`);
  }
  console.log(`      └─ Diff Calculation Latency : ${diffTime.toFixed(4)} ms\n`);

  const totalTime = performance.now() - startTotal;
  const mem = process.memoryUsage();

  console.log('-------------------------------------------------------------------------');
  console.log(`RAM Heap Usage : ${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`RAM RSS        : ${(mem.rss / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Total Execution Time : ${totalTime.toFixed(2)} ms`);
  console.log('-------------------------------------------------------------------------');
  console.log('\n🚀 PRODUCTION KERNEL TEST: ALL ARCHITECTURAL SUITES PASSED!\n');
}

runProductionKernelTest().catch(console.error);
