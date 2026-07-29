// 1.brain/examples/example_usage.ts
import { AgentExecutionEngine } from '../agent_engine.js';

async function main() {
  const engine = new AgentExecutionEngine();

  console.log('Example 1: Analyze repository structure\n');
  
  const analyzeResult = await engine.execute({
    query: 'Analyze the dependency structure of this repository',
    repositoryPath: './kernel/src',
    options: {
      dryRun: true,
      validateImports: true,
    },
  });

  console.log(`Route: ${analyzeResult.route.strategy}`);
  console.log(`Intent: ${analyzeResult.route.intent.type}`);
  console.log(`Files analyzed: ${analyzeResult.route.context.relevantFiles.length}`);
  console.log(`Validation: ${analyzeResult.validation.valid ? 'PASS' : 'FAIL'}\n`);

  console.log('Example 2: Create new utility file\n');

  const createResult = await engine.execute({
    query: 'Create a new file utils/string_utils.ts with capitalize and slugify functions',
    repositoryPath: './kernel/src',
    options: {
      dryRun: true,
      autoApply: false,
    },
  });

  console.log(`Patches generated: ${createResult.patches.length}`);
  for (const patch of createResult.patches) {
    console.log(`\nFile: ${patch.filePath}`);
    console.log(`Operations: ${patch.operations.map(op => op.type).join(', ')}`);
    console.log(`Hunks: ${patch.hunks.length}`);
  }

  console.log('\nExample 3: Refactor existing code\n');

  const refactorResult = await engine.execute({
    query: 'Refactor all files to remove unused imports and sort them alphabetically',
    repositoryPath: './kernel/src',
    options: {
      dryRun: true,
      validateImports: true,
    },
  });

  console.log(`Files to refactor: ${refactorResult.patches.length}`);
  console.log(`Validation errors: ${refactorResult.validation.errors.length}`);
  console.log(`Validation warnings: ${refactorResult.validation.warnings.length}`);

  console.log('\n=== Performance Summary ===\n');
  console.log(`Analyze: ${analyzeResult.stats.totalTime.toFixed(2)}ms`);
  console.log(`Create: ${createResult.stats.totalTime.toFixed(2)}ms`);
  console.log(`Refactor: ${refactorResult.stats.totalTime.toFixed(2)}ms`);
}

main().catch(console.error);
