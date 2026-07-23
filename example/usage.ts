// example/usage.ts

import KlynCodebaseEngine from './kernel/src/indexer';

async function main() {
  console.log('🚀 Initializing KLYN Codebase Engine...\n');

  const engine = new KlynCodebaseEngine({
    rootPath: process.cwd(),
    autoIndex: false,
    merkleDAG: {
      ignorePaths: ['node_modules', '.git', 'dist'],
    },
    hybridSearch: {
      useRipgrep: true,
    },
    contextWeaver: {
      maxTokens: 8000,
    },
  });

  // Event listeners
  engine.on('engine:merkle:complete', () => {
    console.log('✅ Merkle DAG indexed');
  });

  engine.on('engine:ast:complete', () => {
    console.log('✅ AST graph built');
  });

  engine.on('engine:init:complete', ({ duration, stats }) => {
    console.log(`\n✨ Engine initialized in ${duration.toFixed(0)}ms`);
    console.log(`📊 Stats:`, stats);
  });

  // Initialize
  await engine.initialize();

  // Search for a symbol
  console.log('\n🔍 Searching for "SwarmMeshOrchestrator"...');
  const symbolResults = await engine.searchSymbol('SwarmMeshOrchestrator');
  console.log(`Found ${symbolResults.length} results`);

  // Search for text
  console.log('\n🔍 Searching for "consensus algorithm"...');
  const { results, stats } = await engine.search('consensus algorithm', {
    caseSensitive: false,
  });
  console.log(`Found ${results.length} matches in ${stats.searchTime.toFixed(2)}ms`);

  // Weave context for a bug fix
  console.log('\n🧵 Weaving context for bug fix...');
  const context = await engine.weaveBugFixContext(
    'TypeError: Cannot read property hash of undefined',
    'at MerkleDAG.updatePath (merkle_dag.ts:234)',
    'kernel/src/indexer/merkle_dag.ts'
  );

  console.log(`\n📝 Context for AI Agent:`);
  console.log(`Total files: ${context.metadata.totalFiles}`);
  console.log(`Total symbols: ${context.metadata.totalSymbols}`);
  console.log(`Estimated tokens: ${context.metadata.estimatedTokens}`);
  console.log(`Processing time: ${context.metadata.processingTime.toFixed(2)}ms`);

  console.log(`\n${context.formattedContext.substring(0, 500)}...\n`);
}

main().catch(console.error);
