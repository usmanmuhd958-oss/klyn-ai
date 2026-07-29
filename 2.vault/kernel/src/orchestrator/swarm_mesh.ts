// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
// kernel/src/orchestrator/swarm_mesh.ts

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { Logger as SystemLogger } from '../logger';

/**
 * Swarm Mesh Orchestration Engine
 * Production-grade decentralized agent coordination system
 * @version 1.0.0
 */

// ============================================================================
// Type Definitions
// ============================================================================

export enum AgentRole {
  ARCHITECT = 'ARCHITECT',
  CODER = 'CODER',
  REVIEWER = 'REVIEWER',
  AUDITOR = 'AUDITOR',
  BUG_HUNTER = 'BUG_HUNTER',
}

export enum AgentStatus {
  IDLE = 'IDLE',
  BIDDING = 'BIDDING',
  WORKING = 'WORKING',
  STANDBY = 'STANDBY',
  FAILED = 'FAILED',
  OFFLINE = 'OFFLINE',
}

export enum TaskStatus {
  PENDING = 'PENDING',
  BIDDING = 'BIDDING',
  ASSIGNED = 'ASSIGNED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REASSIGNED = 'REASSIGNED',
}

export enum ConsensusAlgorithm {
  HIGHEST_BID = 'HIGHEST_BID',
  WEIGHTED_SCORE = 'WEIGHTED_SCORE',
  RAFT_LEADER = 'RAFT_LEADER',
}

export interface ASTMetadata {
  complexity: number; // 0-100
  linesOfCode: number;
  dependencies: string[];
  estimatedEffort: number; // hours
  requiredSkills: string[];
  riskScore: number; // 0-100
}

export interface AgentCapabilities {
  languages: string[];
  frameworks: string[];
  specializations: string[];
  maxComplexity: number;
  maxConcurrentTasks: number;
}

export interface AgentMetrics {
  tasksCompleted: number;
  tasksFailedCount: number;
  averageCompletionTime: number; // milliseconds
  successRate: number; // 0-1
  averageConfidence: number; // 0-1
  uptimePercentage: number; // 0-100
}

export interface Agent {
  id: string;
  role: AgentRole;
  status: AgentStatus;
  capabilities: AgentCapabilities;
  metrics: AgentMetrics;
  endpoint: string;
  lastHeartbeat: number;
  currentTaskId: string | null;
  version: string;
  metadata: Record<string, unknown>;
}

export interface TaskBid {
  agentId: string;
  taskId: string;
  confidenceScore: number; // 0-1
  estimatedCompletionTime: number; // milliseconds
  proposedApproach: string;
  timestamp: number;
  reasoning: string;
}

export interface TaskContext {
  previousAttempts: Array<{
    agentId: string;
    failureReason: string;
    timestamp: number;
  }>;
  checkpoint: unknown;
  accumulatedResults: unknown[];
  metadata: Record<string, unknown>;
}

export interface Task {
  id: string;
  type: string;
  description: string;
  requirements: string[];
  astMetadata: ASTMetadata;
  status: TaskStatus;
  assignedAgentId: string | null;
  bids: TaskBid[];
  context: TaskContext;
  priority: number; // 0-10
  deadline: number | null; // timestamp
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  result: unknown;
}

export interface SwarmConfig {
  heartbeatInterval: number; // milliseconds
  heartbeatTimeout: number; // milliseconds
  biddingWindow: number; // milliseconds
  consensusAlgorithm: ConsensusAlgorithm;
  minBidsRequired: number;
  maxReassignmentAttempts: number;
  enableHotStandby: boolean;
  standbyRatio: number; // 0-1
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export interface SwarmMetrics {
  totalAgents: number;
  activeAgents: number;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  averageTaskCompletionTime: number;
  swarmEfficiency: number; // 0-1
  consensusLatency: number; // milliseconds
}

// ============================================================================
// Custom Errors
// ============================================================================

export class SwarmError extends Error {
  constructor(
    message: string,
    public code: string,
    public context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'SwarmError';
  }
}

export class AgentRegistrationError extends SwarmError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'AGENT_REGISTRATION_ERROR', context);
    this.name = 'AgentRegistrationError';
  }
}

export class TaskAssignmentError extends SwarmError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'TASK_ASSIGNMENT_ERROR', context);
    this.name = 'TaskAssignmentError';
  }
}

export class ConsensusError extends SwarmError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'CONSENSUS_ERROR', context);
    this.name = 'ConsensusError';
  }
}

// ============================================================================
// Swarm Mesh Orchestrator
// ============================================================================

export class SwarmMeshOrchestrator extends EventEmitter {
  private agents: Map<string, Agent> = new Map();
  private tasks: Map<string, Task> = new Map();
  private heartbeatTimers: Map<string, NodeJS.Timeout> = new Map();
  private biddingTimers: Map<string, NodeJS.Timeout> = new Map();
  private logger: Logger;
  private config: SwarmConfig;
  private metrics: SwarmMetrics;
  private isRunning: boolean = false;

  constructor(config: Partial<SwarmConfig> = {}) {
    super();
    this.config = {
      heartbeatInterval: config.heartbeatInterval ?? 5000,
      heartbeatTimeout: config.heartbeatTimeout ?? 15000,
      biddingWindow: config.biddingWindow ?? 3000,
      consensusAlgorithm: config.consensusAlgorithm ?? ConsensusAlgorithm.WEIGHTED_SCORE,
      minBidsRequired: config.minBidsRequired ?? 2,
      maxReassignmentAttempts: config.maxReassignmentAttempts ?? 3,
      enableHotStandby: config.enableHotStandby ?? true,
      standbyRatio: config.standbyRatio ?? 0.2,
      logLevel: config.logLevel ?? 'info',
    };

    this.logger = new Logger('SwarmMeshOrchestrator', this.config.logLevel);
    this.metrics = this.initializeMetrics();
    this.setupEventHandlers();
  }

  // ============================================================================
  // Initialization & Lifecycle
  // ============================================================================

  private initializeMetrics(): SwarmMetrics {
    return {
      totalAgents: 0,
      activeAgents: 0,
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      averageTaskCompletionTime: 0,
      swarmEfficiency: 0,
      consensusLatency: 0,
    };
  }

  private setupEventHandlers(): void {
    this.on('agent:registered', (agent: Agent) => {
      this.logger.info('Agent registered', { agentId: agent.id, role: agent.role });
    });

    this.on('agent:failed', (agentId: string, reason: string) => {
      this.logger.error('Agent failed', { agentId, reason });
      this.handleAgentFailure(agentId, reason).catch((error) => {
        this.logger.error('Failed to handle agent failure', { error });
      });
    });

    this.on('task:assigned', (taskId: string, agentId: string) => {
      this.logger.info('Task assigned', { taskId, agentId });
    });

    this.on('task:completed', (taskId: string) => {
      this.logger.info('Task completed', { taskId });
      this.updateMetricsOnTaskCompletion(taskId);
    });

    this.on('task:failed', (taskId: string, reason: string) => {
      this.logger.error('Task failed', { taskId, reason });
    });
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Swarm orchestrator is already running');
      return;
    }

    this.logger.info('Starting Swarm Mesh Orchestrator', { config: this.config });
    this.isRunning = true;
    this.emit('swarm:started');
  }

  public async shutdown(): Promise<void> {
    if (!this.isRunning) {
      this.logger.warn('Swarm orchestrator is not running');
      return;
    }

    this.logger.info('Shutting down Swarm Mesh Orchestrator');
    this.isRunning = false;

    // Clear all timers
    for (const timer of this.heartbeatTimers.values()) {
      clearInterval(timer);
    }
    for (const timer of this.biddingTimers.values()) {
      clearTimeout(timer);
    }

    this.heartbeatTimers.clear();
    this.biddingTimers.clear();

    this.emit('swarm:shutdown');
    this.removeAllListeners();
  }

  // ============================================================================
  // Agent Management
  // ============================================================================

  public async registerAgent(
    role: AgentRole,
    capabilities: AgentCapabilities,
    endpoint: string,
    metadata: Record<string, unknown> = {}
  ): Promise<Agent> {
    try {
      const agentId = randomUUID();
      const agent: Agent = {
        id: agentId,
        role,
        status: AgentStatus.IDLE,
        capabilities,
        endpoint,
        lastHeartbeat: Date.now(),
        currentTaskId: null,
        version: '1.0.0',
        metadata,
        metrics: {
          tasksCompleted: 0,
          tasksFailedCount: 0,
          averageCompletionTime: 0,
          successRate: 1.0,
          averageConfidence: 0,
          uptimePercentage: 100,
        },
      };

      this.agents.set(agentId, agent);
      this.startHeartbeatMonitor(agentId);
      
      this.metrics.totalAgents++;
      this.metrics.activeAgents++;

      this.emit('agent:registered', agent);
      this.logger.info('Agent registered successfully', {
        agentId,
        role,
        capabilities,
      });

      return agent;
    } catch (error) {
      const err = error as Error;
      throw new AgentRegistrationError(`Failed to register agent: ${err.message}`, {
        role,
        error: err.message,
      });
    }
  }

  public async deregisterAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new AgentRegistrationError(`Agent not found: ${agentId}`, { agentId });
    }

    this.logger.info('Deregistering agent', { agentId, role: agent.role });

    // Stop heartbeat monitoring
    const timer = this.heartbeatTimers.get(agentId);
    if (timer) {
      clearInterval(timer);
      this.heartbeatTimers.delete(agentId);
    }

    // Handle reassignment if agent has active task
    if (agent.currentTaskId) {
      await this.reassignTask(agent.currentTaskId, 'Agent deregistered');
    }

    agent.status = AgentStatus.OFFLINE;
    this.agents.delete(agentId);
    this.metrics.activeAgents = Math.max(0, this.metrics.activeAgents - 1);

    this.emit('agent:deregistered', agentId);
  }

  public async updateAgentHeartbeat(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new AgentRegistrationError(`Agent not found: ${agentId}`, { agentId });
    }

    agent.lastHeartbeat = Date.now();
    
    if (agent.status === AgentStatus.FAILED || agent.status === AgentStatus.OFFLINE) {
      agent.status = AgentStatus.IDLE;
      this.logger.info('Agent recovered', { agentId });
      this.emit('agent:recovered', agentId);
    }
  }

  private startHeartbeatMonitor(agentId: string): void {
    const timer = setInterval(() => {
      this.checkAgentHeartbeat(agentId).catch((error) => {
        this.logger.error('Heartbeat check failed', { agentId, error });
      });
    }, this.config.heartbeatInterval);

    this.heartbeatTimers.set(agentId, timer);
  }

  private async checkAgentHeartbeat(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    const timeSinceLastHeartbeat = Date.now() - agent.lastHeartbeat;

    if (timeSinceLastHeartbeat > this.config.heartbeatTimeout) {
      this.logger.warn('Agent heartbeat timeout', {
        agentId,
        timeSinceLastHeartbeat,
        timeout: this.config.heartbeatTimeout,
      });

      this.emit('agent:failed', agentId, 'Heartbeat timeout');
    }
  }

  private async handleAgentFailure(agentId: string, reason: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    agent.status = AgentStatus.FAILED;
    agent.metrics.tasksFailedCount++;

    // Update uptime percentage
    const totalTasks = agent.metrics.tasksCompleted + agent.metrics.tasksFailedCount;
    if (totalTasks > 0) {
      agent.metrics.successRate = agent.metrics.tasksCompleted / totalTasks;
    }

    // Reassign current task if any
    if (agent.currentTaskId) {
      await this.reassignTask(agent.currentTaskId, reason);
    }

    this.emit('agent:failure:handled', agentId, reason);
  }

  public getAgent(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  public getAgentsByRole(role: AgentRole): Agent[] {
    return Array.from(this.agents.values()).filter((agent) => agent.role === role);
  }

  public getAgentsByStatus(status: AgentStatus): Agent[] {
    return Array.from(this.agents.values()).filter((agent) => agent.status === status);
  }

  // ============================================================================
  // Task Management
  // ============================================================================

  public async submitTask(
    type: string,
    description: string,
    requirements: string[],
    astMetadata: ASTMetadata,
    priority: number = 5,
    deadline: number | null = null
  ): Promise<Task> {
    try {
      const taskId = randomUUID();
      const task: Task = {
        id: taskId,
        type,
        description,
        requirements,
        astMetadata,
        status: TaskStatus.PENDING,
        assignedAgentId: null,
        bids: [],
        context: {
          previousAttempts: [],
          checkpoint: null,
          accumulatedResults: [],
          metadata: {},
        },
        priority,
        deadline,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        completedAt: null,
        result: null,
      };

      this.tasks.set(taskId, task);
      this.metrics.totalTasks++;

      this.logger.info('Task submitted', {
        taskId,
        type,
        priority,
        complexity: astMetadata.complexity,
      });

      this.emit('task:submitted', task);

      // Start bidding process
      await this.initiateBiddingProcess(taskId);

      return task;
    } catch (error) {
      const err = error as Error;
      throw new TaskAssignmentError(`Failed to submit task: ${err.message}`, {
        type,
        error: err.message,
      });
    }
  }

  private async initiateBiddingProcess(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new TaskAssignmentError(`Task not found: ${taskId}`, { taskId });
    }

    task.status = TaskStatus.BIDDING;
    task.updatedAt = Date.now();

    this.logger.info('Initiating bidding process', {
      taskId,
      biddingWindow: this.config.biddingWindow,
    });

    this.emit('bidding:started', taskId);

    // Request bids from eligible agents
    await this.requestBidsFromAgents(task);

    // Set timer for bidding window closure
    const timer = setTimeout(() => {
      this.closeBiddingAndAssign(taskId).catch((error) => {
        this.logger.error('Failed to close bidding', { taskId, error });
      });
    }, this.config.biddingWindow);

    this.biddingTimers.set(taskId, timer);
  }

  private async requestBidsFromAgents(task: Task): Promise<void> {
    const eligibleAgents = this.findEligibleAgents(task);

    this.logger.debug('Requesting bids from eligible agents', {
      taskId: task.id,
      eligibleAgentCount: eligibleAgents.length,
    });

    const bidPromises = eligibleAgents.map((agent) =>
      this.requestBidFromAgent(agent, task).catch((error) => {
        this.logger.warn('Failed to get bid from agent', {
          agentId: agent.id,
          taskId: task.id,
          error,
        });
        return null;
      })
    );

    await Promise.all(bidPromises);
  }

  private findEligibleAgents(task: Task): Agent[] {
    return Array.from(this.agents.values()).filter((agent) => {
      // Agent must be idle or in standby
      if (
        agent.status !== AgentStatus.IDLE &&
        agent.status !== AgentStatus.STANDBY
      ) {
        return false;
      }

      // Check complexity capability
      if (task.astMetadata.complexity > agent.capabilities.maxComplexity) {
        return false;
      }

      // Check concurrent task limit
      if (agent.currentTaskId !== null) {
        return false;
      }

      // Check required skills
      const hasRequiredSkills = task.astMetadata.requiredSkills.every((skill) =>
        agent.capabilities.specializations.includes(skill)
      );

      return hasRequiredSkills;
    });
  }

  private async requestBidFromAgent(agent: Agent, task: Task): Promise<TaskBid | null> {
    try {
      // Calculate confidence score based on agent metrics and task metadata
      const confidenceScore = this.calculateConfidenceScore(agent, task);

      // Estimate completion time based on complexity and agent history
      const estimatedCompletionTime = this.estimateCompletionTime(agent, task);

      const bid: TaskBid = {
        agentId: agent.id,
        taskId: task.id,
        confidenceScore,
        estimatedCompletionTime,
        proposedApproach: this.generateProposedApproach(agent, task),
        timestamp: Date.now(),
        reasoning: this.generateBidReasoning(agent, task, confidenceScore),
      };

      agent.status = AgentStatus.BIDDING;
      task.bids.push(bid);

      this.emit('bid:received', bid);
      this.logger.debug('Bid received from agent', {
        agentId: agent.id,
        taskId: task.id,
        confidenceScore,
      });

      return bid;
    } catch (error) {
      const err = error as Error;
      this.logger.error('Failed to generate bid', {
        agentId: agent.id,
        taskId: task.id,
        error: err.message,
      });
      return null;
    }
  }

  private calculateConfidenceScore(agent: Agent, task: Task): number {
    let score = 0;

    // Base score from success rate
    score += agent.metrics.successRate * 0.4;

    // Complexity match
    const complexityRatio = Math.min(
      1,
      agent.capabilities.maxComplexity / task.astMetadata.complexity
    );
    score += complexityRatio * 0.3;

    // Experience factor
    const experienceFactor = Math.min(1, agent.metrics.tasksCompleted / 100);
    score += experienceFactor * 0.2;

    // Uptime reliability
    score += (agent.metrics.uptimePercentage / 100) * 0.1;

    return Math.max(0, Math.min(1, score));
  }

  private estimateCompletionTime(agent: Agent, task: Task): number {
    const baseTime = task.astMetadata.estimatedEffort * 3600000; // hours to ms
    const agentEfficiency = agent.metrics.successRate;
    const complexityMultiplier = 1 + task.astMetadata.complexity / 100;

    return baseTime * complexityMultiplier * (2 - agentEfficiency);
  }

  private generateProposedApproach(agent: Agent, task: Task): string {
    return `${agent.role} approach: Analyze ${task.type} with focus on ${task.requirements.join(', ')}. ` +
      `Utilizing ${agent.capabilities.specializations.slice(0, 3).join(', ')} expertise. ` +
      `Complexity level: ${task.astMetadata.complexity}/100.`;
  }

  private generateBidReasoning(
    agent: Agent,
    task: Task,
    confidenceScore: number
  ): string {
    return `Agent ${agent.id} (${agent.role}) confidence: ${(confidenceScore * 100).toFixed(1)}%. ` +
      `Success rate: ${(agent.metrics.successRate * 100).toFixed(1)}%. ` +
      `Completed ${agent.metrics.tasksCompleted} tasks. ` +
      `Specializations match: ${task.astMetadata.requiredSkills.join(', ')}.`;
  }

  private async closeBiddingAndAssign(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new TaskAssignmentError(`Task not found: ${taskId}`, { taskId });
    }

    const timer = this.biddingTimers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.biddingTimers.delete(taskId);
    }

    this.logger.info('Closing bidding window', {
      taskId,
      bidCount: task.bids.length,
    });

    this.emit('bidding:closed', taskId, task.bids.length);

    if (task.bids.length < this.config.minBidsRequired) {
      this.logger.warn('Insufficient bids received', {
        taskId,
        received: task.bids.length,
        required: this.config.minBidsRequired,
      });

      // Retry bidding process after delay
      setTimeout(() => {
        this.initiateBiddingProcess(taskId).catch((error) => {
          this.logger.error('Failed to retry bidding', { taskId, error });
        });
      }, 2000);
      return;
    }

    try {
      const consensusStartTime = Date.now();
      const winningBid = await this.runConsensusAlgorithm(task);
      const consensusLatency = Date.now() - consensusStartTime;

      this.metrics.consensusLatency = 
        (this.metrics.consensusLatency + consensusLatency) / 2;

      await this.assignTaskToAgent(taskId, winningBid.agentId);
    } catch (error) {
      const err = error as Error;
      this.logger.error('Failed to assign task after consensus', {
        taskId,
        error: err.message,
      });
      task.status = TaskStatus.FAILED;
      this.emit('task:failed', taskId, err.message);
    }
  }

  private async runConsensusAlgorithm(task: Task): Promise<TaskBid> {
    const startTime = Date.now();

    try {
      let winningBid: TaskBid;

      switch (this.config.consensusAlgorithm) {
        case ConsensusAlgorithm.HIGHEST_BID:
          winningBid = this.consensusHighestBid(task.bids);
          break;

        case ConsensusAlgorithm.WEIGHTED_SCORE:
          winningBid = this.consensusWeightedScore(task.bids, task);
          break;

        case ConsensusAlgorithm.RAFT_LEADER:
          winningBid = await this.consensusRaftLeader(task.bids);
          break;

        default:
          winningBid = this.consensusWeightedScore(task.bids, task);
      }

      const duration = Date.now() - startTime;
      this.logger.info('Consensus reached', {
        taskId: task.id,
        algorithm: this.config.consensusAlgorithm,
        winningAgentId: winningBid.agentId,
        confidenceScore: winningBid.confidenceScore,
        duration,
      });

      this.emit('consensus:reached', task.id, winningBid);

      return winningBid;
    } catch (error) {
      const err = error as Error;
      throw new ConsensusError(`Consensus failed: ${err.message}`, {
        taskId: task.id,
        algorithm: this.config.consensusAlgorithm,
        bidCount: task.bids.length,
      });
    }
  }

  private consensusHighestBid(bids: TaskBid[]): TaskBid {
    return bids.reduce((highest, current) =>
      current.confidenceScore > highest.confidenceScore ? current : highest
    );
  }

  private consensusWeightedScore(bids: TaskBid[], task: Task): TaskBid {
    const scoredBids = bids.map((bid) => {
      const agent = this.agents.get(bid.agentId);
      if (!agent) {
        return { bid, score: 0 };
      }

      // Weighted scoring formula
      const confidenceWeight = 0.4;
      const timeWeight = 0.3;
      const reliabilityWeight = 0.2;
      const priorityWeight = 0.1;

      const normalizedTime = 1 - Math.min(1, bid.estimatedCompletionTime / 86400000);
      const priorityBonus = task.priority / 10;

      const score =
        bid.confidenceScore * confidenceWeight +
        normalizedTime * timeWeight +
        agent.metrics.successRate * reliabilityWeight +
        priorityBonus * priorityWeight;

      return { bid, score };
    });

    const winner = scoredBids.reduce((highest, current) =>
      current.score > highest.score ? current : highest
    );

    return winner.bid;
  }

  private async consensusRaftLeader(bids: TaskBid[]): Promise<TaskBid> {
    // Simplified Raft-inspired leader election
    // In production, this would implement full Raft consensus
    const sortedBids = [...bids].sort((a, b) => {
      const agentA = this.agents.get(a.agentId);
      const agentB = this.agents.get(b.agentId);
      
      if (!agentA || !agentB) return 0;

      // Leader score based on uptime and success rate
      const scoreA = agentA.metrics.uptimePercentage * agentA.metrics.successRate;
      const scoreB = agentB.metrics.uptimePercentage * agentB.metrics.successRate;

      return scoreB - scoreA;
    });

    return sortedBids[0];
  }

  private async assignTaskToAgent(taskId: string, agentId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    const agent = this.agents.get(agentId);

    if (!task || !agent) {
      throw new TaskAssignmentError('Task or agent not found', { taskId, agentId });
    }

    task.status = TaskStatus.ASSIGNED;
    task.assignedAgentId = agentId;
    task.updatedAt = Date.now();

    agent.status = AgentStatus.WORKING;
    agent.currentTaskId = taskId;

    // Set standby agents if enabled
    if (this.config.enableHotStandby) {
      await this.assignStandbyAgents(task);
    }

    this.emit('task:assigned', taskId, agentId);
    this.logger.info('Task assigned to agent', { taskId, agentId, role: agent.role });

    // Simulate task execution (in production, this would call the actual agent)
    this.executeTask(taskId).catch((error) => {
      this.logger.error('Task execution failed', { taskId, error });
    });
  }

  private async assignStandbyAgents(task: Task): Promise<void> {
    const standbysNeeded = Math.ceil(this.config.standbyRatio * task.bids.length);
    const sortedBids = [...task.bids]
      .filter((bid) => bid.agentId !== task.assignedAgentId)
      .sort((a, b) => b.confidenceScore - a.confidenceScore);

    const standbyAgentIds = sortedBids
      .slice(0, standbysNeeded)
      .map((bid) => bid.agentId);

    for (const agentId of standbyAgentIds) {
      const agent = this.agents.get(agentId);
      if (agent && agent.status === AgentStatus.BIDDING) {
        agent.status = AgentStatus.STANDBY;
        this.logger.debug('Agent assigned as standby', {
          agentId,
          taskId: task.id,
        });
      }
    }
  }

  private async executeTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = TaskStatus.IN_PROGRESS;
    task.updatedAt = Date.now();

    this.emit('task:started', taskId);

    try {
      // Simulate task execution with progress updates
      const result = await this.simulateTaskExecution(task);

      task.status = TaskStatus.COMPLETED;
      task.result = result;
      task.completedAt = Date.now();
      task.updatedAt = Date.now();

      const agent = this.agents.get(task.assignedAgentId!);
      if (agent) {
        agent.status = AgentStatus.IDLE;
        agent.currentTaskId = null;
        agent.metrics.tasksCompleted++;

        const completionTime = task.completedAt - task.createdAt;
        agent.metrics.averageCompletionTime =
          (agent.metrics.averageCompletionTime + completionTime) / 2;

        const totalTasks = agent.metrics.tasksCompleted + agent.metrics.tasksFailedCount;
        agent.metrics.successRate = agent.metrics.tasksCompleted / totalTasks;
      }

      // Release standby agents
      await this.releaseStandbyAgents(taskId);

      this.emit('task:completed', taskId);
    } catch (error) {
      const err = error as Error;
      await this.handleTaskFailure(taskId, err.message);
    }
  }

  private async simulateTaskExecution(task: Task): Promise<unknown> {
    // Simulate execution time based on complexity
    const executionTime = task.astMetadata.estimatedEffort * 100; // Reduced for demo

    await new Promise((resolve) => setTimeout(resolve, executionTime));

    return {
      taskId: task.id,
      status: 'success',
      output: `Task ${task.type} completed successfully`,
      metrics: {
        linesProcessed: task.astMetadata.linesOfCode,
        complexityHandled: task.astMetadata.complexity,
      },
    };
  }

  private async handleTaskFailure(taskId: string, reason: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    this.logger.error('Task execution failed', { taskId, reason });

    task.context.previousAttempts.push({
      agentId: task.assignedAgentId!,
      failureReason: reason,
      timestamp: Date.now(),
    });

    const agent = this.agents.get(task.assignedAgentId!);
    if (agent) {
      agent.status = AgentStatus.IDLE;
      agent.currentTaskId = null;
      agent.metrics.tasksFailedCount++;
    }

    // Check if we should reassign
    if (
      task.context.previousAttempts.length < this.config.maxReassignmentAttempts
    ) {
      await this.reassignTask(taskId, reason);
    } else {
      task.status = TaskStatus.FAILED;
      task.updatedAt = Date.now();
      this.metrics.failedTasks++;
      this.emit('task:failed', taskId, reason);
    }
  }

  private async reassignTask(taskId: string, reason: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    this.logger.info('Reassigning task', {
      taskId,
      reason,
      attemptNumber: task.context.previousAttempts.length + 1,
    });

    task.status = TaskStatus.REASSIGNED;
    task.assignedAgentId = null;
    task.updatedAt = Date.now();

    this.emit('task:reassigning', taskId, reason);

    // Try standby agents first
    const standbyAgent = await this.findStandbyAgent(task);
    if (standbyAgent) {
      await this.assignTaskToAgent(taskId, standbyAgent.id);
      return;
    }

    // Otherwise, restart bidding process
    task.bids = [];
    await this.initiateBiddingProcess(taskId);
  }

  private async findStandbyAgent(task: Task): Promise<Agent | null> {
    const standbyAgents = Array.from(this.agents.values()).filter(
      (agent) => agent.status === AgentStatus.STANDBY
    );

    if (standbyAgents.length === 0) return null;

    // Find standby agent that previously bid on this task
    const previousBidder = standbyAgents.find((agent) =>
      task.bids.some((bid) => bid.agentId === agent.id)
    );

    return previousBidder || standbyAgents[0];
  }

  private async releaseStandbyAgents(taskId: string): Promise<void> {
    for (const agent of this.agents.values()) {
      if (agent.status === AgentStatus.STANDBY) {
        agent.status = AgentStatus.IDLE;
      }
    }
  }

  private updateMetricsOnTaskCompletion(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task || !task.completedAt) return;

    this.metrics.completedTasks++;

    const completionTime = task.completedAt - task.createdAt;
    this.metrics.averageTaskCompletionTime =
      (this.metrics.averageTaskCompletionTime + completionTime) / 2;

    this.metrics.swarmEfficiency =
      this.metrics.completedTasks / this.metrics.totalTasks;
  }

  // ============================================================================
  // Query & Monitoring
  // ============================================================================

  public getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  public getTasksByStatus(status: TaskStatus): Task[] {
    return Array.from(this.tasks.values()).filter((task) => task.status === status);
  }

  public getSwarmMetrics(): SwarmMetrics {
    return { ...this.metrics };
  }

  public getAgentMetrics(agentId: string): AgentMetrics | undefined {
    return this.agents.get(agentId)?.metrics;
  }

  public async getSwarmHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'critical';
    details: Record<string, unknown>;
  }> {
    const activeAgentRatio = this.metrics.activeAgents / Math.max(1, this.metrics.totalAgents);
    const successRate = this.metrics.completedTasks / Math.max(1, this.metrics.totalTasks);

    let status: 'healthy' | 'degraded' | 'critical';
    if (activeAgentRatio > 0.8 && successRate > 0.9) {
      status = 'healthy';
    } else if (activeAgentRatio > 0.5 && successRate > 0.7) {
      status = 'degraded';
    } else {
      status = 'critical';
    }

    return {
      status,
      details: {
        activeAgentRatio,
        successRate,
        metrics: this.metrics,
        agentsByStatus: {
          idle: this.getAgentsByStatus(AgentStatus.IDLE).length,
          working: this.getAgentsByStatus(AgentStatus.WORKING).length,
          standby: this.getAgentsByStatus(AgentStatus.STANDBY).length,
          failed: this.getAgentsByStatus(AgentStatus.FAILED).length,
        },
        tasksByStatus: {
          pending: this.getTasksByStatus(TaskStatus.PENDING).length,
          bidding: this.getTasksByStatus(TaskStatus.BIDDING).length,
          inProgress: this.getTasksByStatus(TaskStatus.IN_PROGRESS).length,
          completed: this.getTasksByStatus(TaskStatus.COMPLETED).length,
          failed: this.getTasksByStatus(TaskStatus.FAILED).length,
        },
      },
    };
  }

  public getAllAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  public getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }
}

// ============================================================================
// Logger Implementation (kernel/logger.ts integration)
// ============================================================================

/**
 * Production Logger with structured logging
 */
export class Logger {
  private context: string;
  private level: 'debug' | 'info' | 'warn' | 'error';

  constructor(context: string, level: 'debug' | 'info' | 'warn' | 'error' = 'info') {
    this.context = context;
    this.level = level;
  }

  private shouldLog(level: 'debug' | 'info' | 'warn' | 'error'): boolean {
    const levels = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.level);
  }

  private formatMessage(level: string, message: string, meta?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? JSON.stringify(meta, null, 2) : '';
    return `[${timestamp}] [${level.toUpperCase()}] [${this.context}] ${message} ${metaStr}`;
  }

  public debug(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage('debug', message, meta));
    }
  }

  public info(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage('info', message, meta));
    }
  }

  public warn(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, meta));
    }
  }

  public error(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message, meta));
    }
  }
}

// ============================================================================
// Export
// ============================================================================

export default SwarmMeshOrchestrator;
