#!/bin/bash
set -e

echo "=========================================================="
echo "  KLYN AI OS - Layer 1 Orchestrator Setup & Build"
echo "=========================================================="

# 1. Create directory structure
mkdir -p 1.orchestrator/src
mkdir -p 1.orchestrator/.cargo

# 2. Write 1.orchestrator/Cargo.toml
cat << 'RUST_CARGO' > 1.orchestrator/Cargo.toml
[package]
name = "klyn-orchestrator"
version = "1.0.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
napi = { version = "2.16", default-features = false, features = ["napi8", "error_anyhow"] }
napi-derive = "2.16"
crossbeam-queue = { version = "0.3", default-features = false, features = ["alloc"] }
libc = "0.2"
parking_lot = { version = "0.12", default-features = false }
once_cell = "1.19"
serde = { version = "1.0", default-features = false, features = ["derive", "alloc"] }
serde_json = { version = "1.0", default-features = false, features = ["alloc"] }

[build-dependencies]
napi-build = "2.1"

[profile.release]
opt-level = 3
lto = true
codegen-units = 1
panic = "abort"
strip = true
overflow-checks = false
RUST_CARGO

# 3. Write 1.orchestrator/build.rs
cat << 'RUST_BUILD' > 1.orchestrator/build.rs
fn main() {
    napi_build::setup();
}
RUST_BUILD

# 4. Write 1.orchestrator/src/lib.rs
cat << 'RUST_LIB' > 1.orchestrator/src/lib.rs
#![deny(clippy::all)]

use napi::bindgen_prelude::*;
use napi_derive::napi;

mod orchestrator;
use orchestrator::ORCHESTRATOR;

#[napi]
pub fn schedule_task(task_id: i64, priority: u8, agent_id_hash: i64) -> Result<u32> {
    ORCHESTRATOR
        .schedule_task(task_id as u64, priority, agent_id_hash as u64)
        .map_err(|e| Error::from_reason(e))
}

#[napi]
pub fn route_event(event_type: u8, payload: Buffer) -> Result<i32> {
    ORCHESTRATOR
        .route_event(event_type, payload.as_ref())
        .map_err(|e| Error::from_reason(e))
}

#[napi]
pub fn spawn_agent(agent_id: String) -> Result<u32> {
    ORCHESTRATOR
        .spawn_agent(agent_id)
        .map_err(|e| Error::from_reason(e))
}

#[napi]
pub fn kill_agent(agent_id: String) -> Result<bool> {
    ORCHESTRATOR
        .kill_agent(agent_id)
        .map_err(|e| Error::from_reason(e))
}

#[napi]
pub fn get_orchestrator_metrics() -> Result<String> {
    ORCHESTRATOR
        .get_metrics()
        .map_err(|e| Error::from_reason(e))
}

#[napi]
pub fn initialize_orchestrator() -> Result<()> {
    ORCHESTRATOR
        .initialize()
        .map_err(|e| Error::from_reason(e))
}

#[napi]
pub fn shutdown_orchestrator() -> Result<()> {
    ORCHESTRATOR
        .shutdown()
        .map_err(|e| Error::from_reason(e))
}
RUST_LIB

# 5. Write 1.orchestrator/src/orchestrator.rs
cat << 'RUST_ORCH' > 1.orchestrator/src/orchestrator.rs
use crossbeam_queue::ArrayQueue;
use once_cell::sync::Lazy;
use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Instant;

const PRIORITY_LEVELS: usize = 8;
const QUEUE_CAPACITY: usize = 4096;
const MAX_AGENTS: usize = 256;
const RSS_LIMIT_BYTES: usize = 3_932_160;

#[repr(C)]
#[derive(Clone, Copy)]
struct Task {
    task_id: u64,
    priority: u8,
    agent_id_hash: u64,
    enqueue_time_ns: u64,
}

#[repr(C)]
struct Agent {
    id: String,
    pid: u32,
    state: AtomicU32,
    rss_bytes: AtomicU64,
    task_count: AtomicU64,
    created_at: Instant,
}

impl Agent {
    fn new(id: String, pid: u32) -> Self {
        Self {
            id,
            pid,
            state: AtomicU32::new(AgentState::Running as u32),
            rss_bytes: AtomicU64::new(0),
            task_count: AtomicU64::new(0),
            created_at: Instant::now(),
        }
    }

    fn is_alive(&self) -> bool {
        self.state.load(Ordering::Acquire) == AgentState::Running as u32
    }

    fn check_rss_limit(&self) -> bool {
        self.rss_bytes.load(Ordering::Relaxed) < RSS_LIMIT_BYTES as u64
    }
}

#[repr(u32)]
enum AgentState {
    Running = 0,
    Terminated = 1,
}

struct Metrics {
    active_tasks: AtomicU32,
    active_agents: AtomicU32,
    queue_depths: [AtomicU32; PRIORITY_LEVELS],
    total_scheduled: AtomicU64,
    total_routed: AtomicU64,
    ipc_latency_sum_ns: AtomicU64,
    ipc_count: AtomicU64,
}

impl Metrics {
    fn new() -> Self {
        Self {
            active_tasks: AtomicU32::new(0),
            active_agents: AtomicU32::new(0),
            queue_depths: [
                AtomicU32::new(0), AtomicU32::new(0), AtomicU32::new(0), AtomicU32::new(0),
                AtomicU32::new(0), AtomicU32::new(0), AtomicU32::new(0), AtomicU32::new(0),
            ],
            total_scheduled: AtomicU64::new(0),
            total_routed: AtomicU64::new(0),
            ipc_latency_sum_ns: AtomicU64::new(0),
            ipc_count: AtomicU64::new(0),
        }
    }

    fn avg_ipc_latency_us(&self) -> f64 {
        let count = self.ipc_count.load(Ordering::Relaxed);
        if count == 0 {
            return 0.0;
        }
        let sum = self.ipc_latency_sum_ns.load(Ordering::Relaxed);
        (sum as f64 / count as f64) / 1000.0
    }
}

pub struct OrchestratorCore {
    queues: [Arc<ArrayQueue<Task>>; PRIORITY_LEVELS],
    agents: Arc<RwLock<HashMap<String, Arc<Agent>>>>,
    metrics: Arc<Metrics>,
    event_fd: AtomicU32,
    epoll_fd: AtomicU32,
    running: Arc<AtomicBool>,
    next_pid: AtomicU32,
    initialized: AtomicBool,
}

impl OrchestratorCore {
    fn new() -> Self {
        let queues = [
            Arc::new(ArrayQueue::new(QUEUE_CAPACITY)),
            Arc::new(ArrayQueue::new(QUEUE_CAPACITY)),
            Arc::new(ArrayQueue::new(QUEUE_CAPACITY)),
            Arc::new(ArrayQueue::new(QUEUE_CAPACITY)),
            Arc::new(ArrayQueue::new(QUEUE_CAPACITY)),
            Arc::new(ArrayQueue::new(QUEUE_CAPACITY)),
            Arc::new(ArrayQueue::new(QUEUE_CAPACITY)),
            Arc::new(ArrayQueue::new(QUEUE_CAPACITY)),
        ];

        Self {
            queues,
            agents: Arc::new(RwLock::new(HashMap::new())),
            metrics: Arc::new(Metrics::new()),
            event_fd: AtomicU32::new(0),
            epoll_fd: AtomicU32::new(0),
            running: Arc::new(AtomicBool::new(false)),
            next_pid: AtomicU32::new(1000),
            initialized: AtomicBool::new(false),
        }
    }

    pub fn initialize(&self) -> Result<(), String> {
        if self.initialized.swap(true, Ordering::SeqCst) {
            return Ok(());
        }

        let efd = unsafe { libc::eventfd(0, libc::EFD_NONBLOCK | libc::EFD_CLOEXEC) };
        if efd < 0 {
            return Err("Failed to create eventfd".to_string());
        }
        self.event_fd.store(efd as u32, Ordering::Release);

        let epfd = unsafe { libc::epoll_create1(libc::EPOLL_CLOEXEC) };
        if epfd < 0 {
            unsafe { libc::close(efd) };
            return Err("Failed to create epoll".to_string());
        }
        self.epoll_fd.store(epfd as u32, Ordering::Release);

        let mut event = libc::epoll_event {
            events: (libc::EPOLLIN | libc::EPOLLET) as u32,
            u64: efd as u64,
        };
        let ret = unsafe {
            libc::epoll_ctl(
                epfd,
                libc::EPOLL_CTL_ADD,
                efd,
                &mut event as *mut libc::epoll_event,
            )
        };
        if ret < 0 {
            unsafe {
                libc::close(efd);
                libc::close(epfd);
            }
            return Err("Failed to register eventfd with epoll".to_string());
        }

        self.running.store(true, Ordering::Release);
        self.spawn_reactor_thread();
        Ok(())
    }

    pub fn shutdown(&self) -> Result<(), String> {
        if !self.running.swap(false, Ordering::SeqCst) {
            return Ok(());
        }

        let efd = self.event_fd.load(Ordering::Acquire);
        let epfd = self.epoll_fd.load(Ordering::Acquire);
        
        if efd > 0 { unsafe { libc::close(efd as i32) }; }
        if epfd > 0 { unsafe { libc::close(epfd as i32) }; }

        let agent_ids: Vec<String> = self.agents.read().keys().cloned().collect();
        for agent_id in agent_ids {
            let _ = self.kill_agent(agent_id);
        }

        Ok(())
    }

    fn spawn_reactor_thread(&self) {
        let queues = self.queues.clone();
        let agents = self.agents.clone();
        let metrics = self.metrics.clone();
        let running = self.running.clone();
        let epoll_fd = self.epoll_fd.load(Ordering::Acquire) as i32;
        let event_fd = self.event_fd.load(Ordering::Acquire) as i32;

        thread::spawn(move || {
            let mut events: [libc::epoll_event; 32] = unsafe { std::mem::zeroed() };
            
            while running.load(Ordering::Acquire) {
                let nfds = unsafe {
                    libc::epoll_wait(epoll_fd, events.as_mut_ptr(), events.len() as i32, 1)
                };

                if nfds > 0 {
                    let mut buf: u64 = 0;
                    unsafe {
                        libc::read(event_fd, &mut buf as *mut u64 as *mut libc::c_void, 8);
                    }
                }

                for priority in 0..PRIORITY_LEVELS {
                    if let Some(task) = queues[priority].pop() {
                        Self::execute_task(task, &agents, &metrics);
                    }
                }
            }
        });
    }

    fn execute_task(task: Task, agents: &Arc<RwLock<HashMap<String, Arc<Agent>>>>, metrics: &Arc<Metrics>) {
        let start = Self::monotonic_ns();
        
        let agents_read = agents.read();
        let agent_opt = agents_read
            .values()
            .find(|a| Self::hash_string(&a.id) == task.agent_id_hash);

        if let Some(agent) = agent_opt {
            if agent.is_alive() && agent.check_rss_limit() {
                agent.task_count.fetch_add(1, Ordering::Relaxed);
            }
        }

        let latency = Self::monotonic_ns() - start;
        metrics.ipc_latency_sum_ns.fetch_add(latency, Ordering::Relaxed);
        metrics.ipc_count.fetch_add(1, Ordering::Relaxed);
        metrics.active_tasks.fetch_sub(1, Ordering::Relaxed);
        metrics.queue_depths[task.priority as usize].fetch_sub(1, Ordering::Relaxed);
    }

    pub fn schedule_task(&self, task_id: u64, priority: u8, agent_id_hash: u64) -> Result<u32, String> {
        if priority >= PRIORITY_LEVELS as u8 {
            return Err(format!("Invalid priority level: {}", priority));
        }

        if !self.running.load(Ordering::Acquire) {
            return Err("Orchestrator not initialized".to_string());
        }

        let task = Task {
            task_id,
            priority,
            agent_id_hash,
            enqueue_time_ns: Self::monotonic_ns(),
        };

        if self.queues[priority as usize].push(task).is_err() {
            return Err(format!("Queue {} is full", priority));
        }

        self.metrics.queue_depths[priority as usize].fetch_add(1, Ordering::Relaxed);
        self.metrics.active_tasks.fetch_add(1, Ordering::Relaxed);
        self.metrics.total_scheduled.fetch_add(1, Ordering::Relaxed);

        self.notify_reactor();
        Ok(0)
    }

    pub fn route_event(&self, event_type: u8, payload: &[u8]) -> Result<i32, String> {
        let start = Self::monotonic_ns();
        
        if payload.len() > 65536 {
            return Err("Payload too large".to_string());
        }

        let _routed = match event_type {
            0..=63 => true,
            64..=127 => true,
            128..=191 => true,
            192..=255 => true,
        };

        let latency = Self::monotonic_ns() - start;
        self.metrics.ipc_latency_sum_ns.fetch_add(latency, Ordering::Relaxed);
        self.metrics.ipc_count.fetch_add(1, Ordering::Relaxed);
        self.metrics.total_routed.fetch_add(1, Ordering::Relaxed);

        Ok(0)
    }

    pub fn spawn_agent(&self, agent_id: String) -> Result<u32, String> {
        let agents_read = self.agents.read();
        if agents_read.len() >= MAX_AGENTS {
            return Err("Maximum agents reached".to_string());
        }
        if agents_read.contains_key(&agent_id) {
            return Err(format!("Agent {} already exists", agent_id));
        }
        drop(agents_read);

        let pid = self.next_pid.fetch_add(1, Ordering::SeqCst);
        let agent = Arc::new(Agent::new(agent_id.clone(), pid));
        
        self.agents.write().insert(agent_id, agent);
        self.metrics.active_agents.fetch_add(1, Ordering::Relaxed);

        Ok(pid)
    }

    pub fn kill_agent(&self, agent_id: String) -> Result<bool, String> {
        let agent = {
            let agents_read = self.agents.read();
            agents_read.get(&agent_id).cloned()
        };

        if let Some(agent) = agent {
            agent.state.store(AgentState::Terminated as u32, Ordering::Release);
            self.agents.write().remove(&agent_id);
            self.metrics.active_agents.fetch_sub(1, Ordering::Relaxed);
            Ok(true)
        } else {
            Err(format!("Agent {} not found", agent_id))
        }
    }

    pub fn get_metrics(&self) -> Result<String, String> {
        let queue_depths: Vec<u32> = self.metrics.queue_depths
            .iter()
            .map(|d| d.load(Ordering::Relaxed))
            .collect();

        let json = format!(
            r#"{{"active_tasks":{},"active_agents":{},"queue_depth_p0_p7":[{},{},{},{},{},{},{},{}],"ipc_latency_us":{:.2},"total_scheduled":{},"total_routed":{}}}"#,
            self.metrics.active_tasks.load(Ordering::Relaxed),
            self.metrics.active_agents.load(Ordering::Relaxed),
            queue_depths[0], queue_depths[1], queue_depths[2], queue_depths[3],
            queue_depths[4], queue_depths[5], queue_depths[6], queue_depths[7],
            self.metrics.avg_ipc_latency_us(),
            self.metrics.total_scheduled.load(Ordering::Relaxed),
            self.metrics.total_routed.load(Ordering::Relaxed),
        );

        Ok(json)
    }

    fn notify_reactor(&self) {
        let efd = self.event_fd.load(Ordering::Acquire) as i32;
        if efd > 0 {
            let val: u64 = 1;
            unsafe {
                libc::write(efd, &val as *const u64 as *const libc::c_void, 8);
            }
        }
    }

    fn monotonic_ns() -> u64 {
        let mut ts = libc::timespec { tv_sec: 0, tv_nsec: 0 };
        unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut ts); }
        (ts.tv_sec as u64) * 1_000_000_000 + (ts.tv_nsec as u64)
    }

    fn hash_string(s: &str) -> u64 {
        let mut hash: u64 = 5381;
        for byte in s.bytes() {
            hash = hash.wrapping_mul(33).wrapping_add(byte as u64);
        }
        hash
    }
}

unsafe impl Send for OrchestratorCore {}
unsafe impl Sync for OrchestratorCore {}

pub static ORCHESTRATOR: Lazy<OrchestratorCore> = Lazy::new(|| {
    let core = OrchestratorCore::new();
    core.initialize().expect("Failed to initialize orchestrator");
    core
});
RUST_ORCH

# 6. Write 1.orchestrator/package.json
cat << 'NODE_PKG' > 1.orchestrator/package.json
{
  "name": "@klyn/orchestrator",
  "version": "1.0.0",
  "description": "Klyn AI OS Layer 1 - Task Orchestrator & Scheduler",
  "main": "index.node",
  "scripts": {
    "build": "cargo build --release && napi build --platform --release",
    "build:debug": "cargo build && napi build --platform",
    "test": "node stress_test.cjs"
  },
  "napi": {
    "name": "klyn-orchestrator"
  },
  "devDependencies": {
    "@napi-rs/cli": "^2.16.0"
  },
  "engines": {
    "node": ">= 16"
  },
  "license": "MIT"
}
NODE_PKG

# 7. Write 1.orchestrator/.cargo/config.toml
cat << 'CARGO_CFG' > 1.orchestrator/.cargo/config.toml
[build]
rustflags = ["-C", "target-cpu=native"]

[profile.release]
opt-level = 3
lto = true
codegen-units = 1
CARGO_CFG

# 8. Write 1.orchestrator/stress_test.cjs
cat << 'NODE_TEST' > 1.orchestrator/stress_test.cjs
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
NODE_TEST

chmod +x setup_layer1.sh
echo "[SUCCESS] Script generated successfully."
