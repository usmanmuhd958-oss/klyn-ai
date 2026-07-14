const { getEvolutionEngine } = require('../kernel/src/execution/evolution_engine');
const { vault, TOKEN_SCOPE } = require('../kernel/token-vault');
const { createLogger, generateCorrelationId } = require('../kernel/src/observability/logger');
const fs = require('fs');

const log = createLogger('DryRunTest');
const engine = getEvolutionEngine();

async function testEvolution() {
  console.log('[TEST] Evolution Engine Self-Mutation Test');
  
  const targetFile = process.env.MUTATION_TARGET_FILE;
  console.log('[TEST] Target file:', targetFile);
  
  try {
    // Read current content
    const originalContent = fs.readFileSync(targetFile, 'utf8');
    console.log('[TEST] Original file size:', originalContent.length, 'bytes');
    
    // Generate mutated content (safe, additive change)
    const mutatedContent = originalContent.replace(
      '## Mutation History',
      `## Autonomous Mutation Test\n\n` +
      `This section was added by the Evolution Engine during a dry run test.\n\n` +
      `- Mutation ID: ${generateCorrelationId()}\n` +
      `- Timestamp: ${new Date().toISOString()}\n` +
      `- Status: TESTING\n\n` +
      `## Mutation History`
    );
    
    console.log('[TEST] Mutated file size:', mutatedContent.length, 'bytes');
    console.log('[TEST] Delta:', mutatedContent.length - originalContent.length, 'bytes added');
    
    // Issue a vault token for authorization
    const authToken = vault.issueToken({
      requesterId: 'DryRunTest',
      scope: TOKEN_SCOPE.AGENT_SPAWN,  // Reuse for evolution authorization
      ttlMs: 120_000,
      correlId: 'dry-run-mutation-001',
    });
    
    console.log('[TEST] Vault token obtained');
    
    // Propose the evolution
    console.log('[TEST] Submitting evolution proposal...');
    
    const result = await engine.propose({
      targetFile,
      patchContent: mutatedContent,
      reason: 'Dry run self-mutation test — safe additive documentation change',
      requesterId: 'DryRunTest',
      expectedMetrics: {
        durationMs: 100,  // Expected to be fast (simple file write)
      },
      vaultToken: authToken,
    });
    
    console.log('[TEST] Evolution result:', JSON.stringify(result, null, 2));
    
    if (result.status === 'COMPLETED') {
      console.log('[SUCCESS] Evolution mutation applied successfully');
      console.log('[SUCCESS] Evolution ID:', result.evolutionId);
      console.log('[SUCCESS] Commit hash:', result.commitHash);
      
      // Verify the file was actually changed
      const newContent = fs.readFileSync(targetFile, 'utf8');
      if (newContent.includes('Autonomous Mutation Test')) {
        console.log('[VERIFY] Mutation content verified in file');
      } else {
        throw new Error('Mutation was reported as successful but content not found in file');
      }
      
      process.exit(0);
    } else {
      throw new Error(`Evolution failed with status: ${result.status}`);
    }
    
  } catch (err) {
    console.error('[ERROR] Evolution Engine test failed:', err.message);
    console.error('[ERROR] Stack:', err.stack);
    process.exit(1);
  }
}

testEvolution();
