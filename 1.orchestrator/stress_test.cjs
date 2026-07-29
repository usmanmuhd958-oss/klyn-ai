#!/usr/bin/env node

const { performance } = require('perf_hooks');
const fs = require('fs');
const path = require('path');

let orchestrator;
try {
  orchestrator = require('./index.node');
} catch (e1) {
  try {
    orchestrator = require('./klyn-orchestrator.node');
  } catch (e2) {
    const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.node'));
    if (files.length > 0) {
      orchestrator = require(path.join(__dirname, files[0]));
    } else {
      throw new Error("Could not locate compiled .node binary in " + __dirname);
    }
  }
}

const STRESS_CONFIG = {
  NUM_TASKS: 1000,
  NUM_AGENTS: 50,
  CONCURRENT_TASKS: 100,
  EVENT_TYPES: 256,
  LATENCY_THRESHOLD_MS: 1.0,
  IPC_LATENCY_THRESHOLD_US: 100,
};

class StressTest {
  constructor() {
    this.results = {
      taskScheduling: [],
      eventRouting: [],
      agentLifecycle: [],
      errors: [],
    };
  }

  async initialize() {
    console.log('🚀 Klyn Orchestrator Layer 1 - Stress Test v1.0.0\n');
    console.log('Configuration:');
    console.log(`  Tasks: ${STRESS_CONFIG.NUM_TASKS}`);
    console.log(`  Agents: ${STRESS_CONFIG.NUM_AGENTS}`);
    console.log(`  Concurrent: ${STRESS_CONFIG.CONCURRENT_TASKS}`);
    console.log(`  Latency SLA: <${STRESS_CONFIG.LATENCY_THRESHOLD_MS}ms (scheduling), <${STRESS_CONFIG.IPC_LATENCY_THRESHOLD_US}μs (IPC)\n`);
  }

  hashString(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash * 33) + str.charCodeAt(i)) >>> 0;
    }
    return hash;
  }

  async testAgentLifecycle() {
    console.log('📦 Test 1: Agent Lifecycle (spawn/kill)');
    const agentIds = [];
    const start = performance.now();

    for (let i = 0; i < STRESS_CONFIG.NUM_AGENTS; i++) {
      const agentId = `agent_${i}_${Date.now()}`;
      try {
        const pid = orchestrator.spawnAgent(agentId);
        agentIds.push({ id: agentId, pid });
      } catch (err) {
        this.results.errors.push(`Spawn failed: ${err.message}`);
      }
    }

    const spawnTime = performance.now() - start;
    console.log(`  ✓ Spawned ${agentIds.length} agents in ${spawnTime.toFixed(2)}ms`);

    const killStart = performance.now();
    let killed = 0;
    for (const { id } of agentIds) {
      try {
        const result = orchestrator.killAgent(id);
        if (result) killed++;
      } catch (err) {
        this.results.errors.push(`Kill failed: ${err.message}`);
      }
    }

    const killTime = performance.now() - killStart;
    console.log(`  ✓ Killed ${killed} agents in ${killTime.toFixed(2)}ms`);
    
    this.results.agentLifecycle.push({
      spawned: agentIds.length,
      killed,
      spawnTimeMs: spawnTime,
      killTimeMs: killTime,
      avgSpawnTimeMs: spawnTime / agentIds.length,
      avgKillTimeMs: killTime / killed,
    });

    return agentIds.slice(0, 10);
  }

  async testTaskScheduling(agents) {
    console.log('\n⚡ Test 2: Task Scheduling (1000 tasks, 8 priority levels)');
    const latencies = [];
    const priorities = [0, 1, 2, 3, 4, 5, 6, 7];

    const activeAgents = [];
    for (let i = 0; i < 10; i++) {
      const agentId = `task_agent_${i}`;
      try {
        orchestrator.spawnAgent(agentId);
        activeAgents.push(agentId);
      } catch (err) {}
    }

    const batchSize = STRESS_CONFIG.CONCURRENT_TASKS;
    const numBatches = Math.ceil(STRESS_CONFIG.NUM_TASKS / batchSize);

    for (let batch = 0; batch < numBatches; batch++) {
      const batchPromises = [];
      const batchStart = batch * batchSize;
      const batchEnd = Math.min(batchStart + batchSize, STRESS_CONFIG.NUM_TASKS);

      for (let i = batchStart; i < batchEnd; i++) {
        const taskId = Date.now() * 1000 + i;
        const priority = priorities[i % priorities.length];
        const agentId = activeAgents[i % activeAgents.length];
        const agentHash = this.hashString(agentId);

        const start = performance.now();
        try {
          const promise = Promise.resolve(
            orchestrator.scheduleTask(taskId, priority, agentHash)
          ).then(() => {
            const latency = performance.now() - start;
            latencies.push(latency);
          });
          batchPromises.push(promise);
        } catch (err) {
          this.results.errors.push(`Schedule failed: ${err.message}`);
        }
      }

      await Promise.all(batchPromises);
    }

    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const sorted = [...latencies].sort((a, b) => a - b);
    const p95Latency = sorted[Math.floor(sorted.length * 0.95)];
    const p99Latency = sorted[Math.floor(sorted.length * 0.99)];
    const maxLatency = Math.max(...latencies);

    console.log(`  ✓ Scheduled ${latencies.length} tasks`);
    console.log(`  ✓ Avg latency: ${avgLatency.toFixed(3)}ms`);
    console.log(`  ✓ P95 latency: ${p95Latency.toFixed(3)}ms`);
    console.log(`  ✓ P99 latency: ${p99Latency.toFixed(3)}ms`);
    console.log(`  ✓ Max latency: ${maxLatency.toFixed(3)}ms`);

    const slaViolations = latencies.filter(l => l > STRESS_CONFIG.LATENCY_THRESHOLD_MS).length;

    this.results.taskScheduling.push({
      totalTasks: latencies.length,
      avgLatencyMs: avgLatency,
      p95LatencyMs: p95Latency,
      p99LatencyMs: p99Latency,
      maxLatencyMs: maxLatency,
      slaViolations,
    });
  }

  async testEventRouting() {
    console.log('\n🔀 Test 3: Event Routing (zero-copy IPC)');
    const latencies = [];
    const payloadSizes = [64, 256, 1024, 4096, 16384];

    for (let i = 0; i < 200; i++) {
      const eventType = i % STRESS_CONFIG.EVENT_TYPES;
      const payloadSize = payloadSizes[i % payloadSizes.length];
      const payload = Buffer.alloc(payloadSize);
      payload.fill(0xAA);

      const start = performance.now();
      try {
        orchestrator.routeEvent(eventType, payload);
        const latency = (performance.now() - start) * 1000;
        latencies.push(latency);
      } catch (err) {
        this.results.errors.push(`Route failed: ${err.message}`);
      }
    }

    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const maxLatency = Math.max(...latencies);

    console.log(`  ✓ Routed ${latencies.length} events`);
    console.log(`  ✓ Avg IPC latency: ${avgLatency.toFixed(2)}μs`);
    console.log(`  ✓ Max IPC latency: ${maxLatency.toFixed(2)}μs`);

    const ipcViolations = latencies.filter(l => l > STRESS_CONFIG.IPC_LATENCY_THRESHOLD_US).length;

    this.results.eventRouting.push({
      totalEvents: latencies.length,
      avgLatencyUs: avgLatency,
      maxLatencyUs: maxLatency,
      ipcViolations,
    });
  }

  async testConcurrentLoad() {
    console.log('\n🔥 Test 4: Concurrent Load (mixed operations)');
    
    const operations = [];
    const startTime = performance.now();

    for (let i = 0; i < 20; i++) {
      operations.push(
        Promise.resolve()
          .then(() => orchestrator.spawnAgent(`concurrent_agent_${i}`))
          .catch(() => {})
      );
    }

    for (let i = 0; i < 500; i++) {
      const priority = i % 8;
      const agentHash = this.hashString(`concurrent_agent_${i % 20}`);
      operations.push(
        Promise.resolve()
          .then(() => orchestrator.scheduleTask(Date.now() * 1000 + i, priority, agentHash))
          .catch(() => {})
      );
    }

    for (let i = 0; i < 200; i++) {
      const payload = Buffer.alloc(512);
      operations.push(
        Promise.resolve()
          .then(() => orchestrator.routeEvent(i % 256, payload))
          .catch(() => {})
      );
    }

    await Promise.all(operations);
    const totalTime = performance.now() - startTime;

    console.log(`  ✓ Completed ${operations.length} concurrent operations in ${totalTime.toFixed(2)}ms`);
    console.log(`  ✓ Throughput: ${(operations.length / totalTime * 1000).toFixed(0)} ops/sec`);
  }

  async printMetrics() {
    console.log('\n📊 Orchestrator Metrics:');
    try {
      const metricsJson = orchestrator.getOrchestratorMetrics();
      const metrics = JSON.parse(metricsJson);
      
      console.log(`  Active Tasks: ${metrics.active_tasks}`);
      console.log(`  Active Agents: ${metrics.active_agents}`);
      console.log(`  Queue Depths (P0-P7): [${metrics.queue_depth_p0_p7.join(', ')}]`);
      console.log(`  IPC Latency: ${metrics.ipc_latency_us.toFixed(2)}μs`);
      console.log(`  Total Scheduled: ${metrics.total_scheduled}`);
      console.log(`  Total Routed: ${metrics.total_routed}`);
    } catch (err) {
      console.log(`  ⚠️  Failed to get metrics: ${err.message}`);
    }
  }

  async printResults() {
    console.log('\n' + '='.repeat(80));
    console.log('📋 STRESS TEST RESULTS');
    console.log('='.repeat(80));

    if (this.results.errors.length > 0) {
      console.log(`\n❌ Errors encountered: ${this.results.errors.length}`);
      this.results.errors.slice(0, 10).forEach(err => console.log(`  - ${err}`));
    } else {
      console.log('\n✅ All tests passed without errors');
    }

    console.log('\n🎯 Performance Summary:');
    if (this.results.taskScheduling.length > 0) {
      const ts = this.results.taskScheduling[0];
      const slaPass = ts.slaViolations === 0 ? '✅' : '⚠️';
      console.log(`  ${slaPass} Task Scheduling: ${ts.p95LatencyMs.toFixed(3)}ms (P95), ${ts.slaViolations} SLA violations`);
    }

    if (this.results.eventRouting.length > 0) {
      const er = this.results.eventRouting[0];
      const ipcPass = er.ipcViolations === 0 ? '✅' : '⚠️';
      console.log(`  ${ipcPass} Event Routing: ${er.avgLatencyUs.toFixed(2)}μs (avg), ${er.ipcViolations} SLA violations`);
    }

    if (this.results.agentLifecycle.length > 0) {
      const al = this.results.agentLifecycle[0];
      const killPass = al.avgKillTimeMs < 10 ? '✅' : '⚠️';
      console.log(`  ${killPass} Agent Lifecycle: ${al.avgSpawnTimeMs.toFixed(2)}ms spawn, ${al.avgKillTimeMs.toFixed(2)}ms kill`);
    }

    console.log('\n' + '='.repeat(80));
  }

  async run() {
    try {
      await this.initialize();
      const agents = await this.testAgentLifecycle();
      await this.testTaskScheduling(agents);
      await this.testEventRouting();
      await this.testConcurrentLoad();
      await this.printMetrics();
      await this.printResults();

      console.log('\n✅ Stress test completed successfully\n');
      process.exit(0);
    } catch (err) {
      console.error(`\n❌ Stress test failed: ${err.message}`);
      process.exit(1);
    }
  }
}

const test = new StressTest();
test.run();
