/**
 * KLYN AI OS - Brain Layer Usage Examples
 */

// @ts-ignore
import { createBrain, type LLMRequest } from './1.brain/index.ts';

async function main() {
  // Initialize the cognitive router
  const brain = createBrain();

  // Example 1: Agentic Coding (auto-routes to Claude Fable 5)
  console.log('\n📝 Example 1: Agentic Coding\n');
  const codingRequest: LLMRequest = {
    prompt: 'Implement a production-grade WebSocket server in TypeScript with automatic reconnection, heartbeat monitoring, and graceful shutdown.',
    taskType: 'agentic_coding',
    maxTokens: 4000,
    temperature: 0.7,
  };

  const codingResponse = await brain.route(codingRequest);
  console.log(`\n✓ Response from ${codingResponse.model}:`);
  console.log(codingResponse.content.slice(0, 200) + '...');
  console.log(`\n💰 Cost: $${codingResponse.cost.totalCost.toFixed(4)}`);

  // Example 2: Log Analysis (auto-routes to DeepSeek for cost efficiency)
  console.log('\n\n🔍 Example 2: Log Analysis\n');
  const logRequest: LLMRequest = {
    prompt: `Analyze this error log and identify root cause:
    [2026-03-15 14:32:01] ERROR: Connection timeout to database
    [2026-03-15 14:32:05] ERROR: Retry attempt 1 failed
    [2026-03-15 14:32:10] ERROR: Connection pool exhausted`,
    taskType: 'log_analysis',
    maxTokens: 1000,
  };

  const logResponse = await brain.route(logRequest);
  console.log(`\n✓ Response from ${logResponse.model}:`);
  console.log(logResponse.content);
  console.log(`\n💰 Cost: $${logResponse.cost.totalCost.toFixed(4)}`);

  // Example 3: Architecture Design (routes to GPT-5.6 Sol)
  console.log('\n\n🏗️  Example 3: Architecture Design\n');
  const archRequest: LLMRequest = {
    prompt: 'Design a microservices architecture for a real-time collaborative code editor with conflict resolution, cursor synchronization, and offline support.',
    taskType: 'architecture',
    maxTokens: 3000,
  };

  const archResponse = await brain.route(archRequest);
  console.log(`\n✓ Response from ${archResponse.model}:`);
  console.log(archResponse.content.slice(0, 300) + '...');

  // Example 4: Massive Context (routes to Gemini 3.5 Pro)
  console.log('\n\n📚 Example 4: Dependency Mapping\n');
  const largeContext = 'import '.repeat(30000); // Simulate large codebase
  const depRequest: LLMRequest = {
    prompt: `${largeContext}\n\nMap all dependencies and identify circular imports.`,
    taskType: 'dependency_mapping',
    maxTokens: 2000,
  };

  const depResponse = await brain.route(depRequest);
  console.log(`\n✓ Response from ${depResponse.model}:`);
  console.log(`Context size: ${depRequest.prompt.length.toLocaleString()} chars`);

  // Generate cost report
  console.log('\n\n' + '='.repeat(60));
  console.log(brain.getGateway().generateCostReport());
  console.log('='.repeat(60));

  // Routing statistics
  // @ts-ignore
  const stats = brain.getRoutingStats();
  console.log('\n📊 Routing Statistics:');
  console.log(`Total Decisions: ${(stats as any).totalDecisions}`);
  console.log(`Avg Confidence: ${((stats as any).averageConfidence * 100).toFixed(1)}%`);
  console.log('Model Distribution:', (stats as any).modelDistribution);
}

main().catch(console.error);
