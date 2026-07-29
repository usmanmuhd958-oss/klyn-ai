// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
// Example: Using the Swarm Mesh Orchestrator

import { SwarmMeshOrchestrator, AgentRole, ConsensusAlgorithm } from './kernel/src/orchestrator/swarm_mesh';

async function main() {
  // Initialize the orchestrator
  const swarm = new SwarmMeshOrchestrator({
    heartbeatInterval: 5000,
    heartbeatTimeout: 15000,
    biddingWindow: 3000,
    consensusAlgorithm: ConsensusAlgorithm.WEIGHTED_SCORE,
    minBidsRequired: 2,
    enableHotStandby: true,
    standbyRatio: 0.2,
    logLevel: 'info',
  });

  // Start the swarm
  await swarm.start();

  // Register agents
  const architect = await swarm.registerAgent(
    AgentRole.ARCHITECT,
    {
      languages: ['TypeScript', 'Python', 'Go'],
      frameworks: ['React', 'Node.js', 'FastAPI'],
      specializations: ['system-design', 'microservices', 'distributed-systems'],
      maxComplexity: 90,
      maxConcurrentTasks: 3,
    },
    'http://agent-architect-01:8080'
  );

  const coder1 = await swarm.registerAgent(
    AgentRole.CODER,
    {
      languages: ['TypeScript', 'JavaScript'],
      frameworks: ['React', 'Node.js', 'Express'],
      specializations: ['frontend', 'backend', 'api-development'],
      maxComplexity: 80,
      maxConcurrentTasks: 5,
    },
    'http://agent-coder-01:8080'
  );

  const coder2 = await swarm.registerAgent(
    AgentRole.CODER,
    {
      languages: ['TypeScript', 'Python'],
      frameworks: ['Node.js', 'Django'],
      specializations: ['backend', 'database', 'api-development'],
      maxComplexity: 75,
      maxConcurrentTasks: 4,
    },
    'http://agent-coder-02:8080'
  );

  const reviewer = await swarm.registerAgent(
    AgentRole.REVIEWER,
    {
      languages: ['TypeScript', 'JavaScript', 'Python'],
      frameworks: ['Jest', 'Mocha', 'Pytest'],
      specializations: ['code-review', 'testing', 'quality-assurance'],
      maxComplexity: 85,
      maxConcurrentTasks: 3,
    },
    'http://agent-reviewer-01:8080'
  );

  // Set up event listeners
  swarm.on('task:assigned', (taskId, agentId) => {
    console.log(`Task ${taskId} assigned to agent ${agentId}`);
  });

  swarm.on('task:completed', (taskId) => {
    console.log(`Task ${taskId} completed successfully`);
  });

  swarm.on('agent:failed', (agentId, reason) => {
    console.error(`Agent ${agentId} failed: ${reason}`);
  });

  // Simulate heartbeats
  setInterval(() => {
    swarm.updateAgentHeartbeat(architect.id).catch(console.error);
    swarm.updateAgentHeartbeat(coder1.id).catch(console.error);
    swarm.updateAgentHeartbeat(coder2.id).catch(console.error);
    swarm.updateAgentHeartbeat(reviewer.id).catch(console.error);
  }, 3000);

  // Submit a complex task
  const task = await swarm.submitTask(
    'feature-implementation',
    'Implement a real-time chat system with WebSocket support',
    [
      'WebSocket integration',
      'Message persistence',
      'User authentication',
      'Real-time notifications',
    ],
    {
      complexity: 75,
      linesOfCode: 2500,
      dependencies: ['socket.io', 'redis', 'postgresql'],
      estimatedEffort: 8,
      requiredSkills: ['backend', 'api-development'],
      riskScore: 45,
    },
    8, // priority
    Date.now() + 86400000 // deadline: 24 hours
  );

  console.log(`Task submitted: ${task.id}`);

  // Monitor swarm health
  setInterval(async () => {
    const health = await swarm.getSwarmHealth();
    console.log('Swarm Health:', health.status);
    console.log('Metrics:', swarm.getSwarmMetrics());
  }, 10000);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down swarm...');
    await swarm.shutdown();
    process.exit(0);
  });
}

main().catch(console.error);
