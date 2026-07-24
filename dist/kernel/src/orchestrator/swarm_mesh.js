// kernel/src/orchestrator/swarm_mesh.ts
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
/**
 * Swarm Mesh Orchestration Engine
 * Production-grade decentralized agent coordination system
 * @version 1.0.0
 */
// ============================================================================
// Type Definitions
// ============================================================================
export var AgentRole;
(function (AgentRole) {
    AgentRole["ARCHITECT"] = "ARCHITECT";
    AgentRole["CODER"] = "CODER";
    AgentRole["REVIEWER"] = "REVIEWER";
    AgentRole["AUDITOR"] = "AUDITOR";
    AgentRole["BUG_HUNTER"] = "BUG_HUNTER";
})(AgentRole || (AgentRole = {}));
export var AgentStatus;
(function (AgentStatus) {
    AgentStatus["IDLE"] = "IDLE";
    AgentStatus["BIDDING"] = "BIDDING";
    AgentStatus["WORKING"] = "WORKING";
    AgentStatus["STANDBY"] = "STANDBY";
    AgentStatus["FAILED"] = "FAILED";
    AgentStatus["OFFLINE"] = "OFFLINE";
})(AgentStatus || (AgentStatus = {}));
export var TaskStatus;
(function (TaskStatus) {
    TaskStatus["PENDING"] = "PENDING";
    TaskStatus["BIDDING"] = "BIDDING";
    TaskStatus["ASSIGNED"] = "ASSIGNED";
    TaskStatus["IN_PROGRESS"] = "IN_PROGRESS";
    TaskStatus["COMPLETED"] = "COMPLETED";
    TaskStatus["FAILED"] = "FAILED";
    TaskStatus["REASSIGNED"] = "REASSIGNED";
})(TaskStatus || (TaskStatus = {}));
export var ConsensusAlgorithm;
(function (ConsensusAlgorithm) {
    ConsensusAlgorithm["HIGHEST_BID"] = "HIGHEST_BID";
    ConsensusAlgorithm["WEIGHTED_SCORE"] = "WEIGHTED_SCORE";
    ConsensusAlgorithm["RAFT_LEADER"] = "RAFT_LEADER";
})(ConsensusAlgorithm || (ConsensusAlgorithm = {}));
// ============================================================================
// Custom Errors
// ============================================================================
export class SwarmError extends Error {
    code;
    context;
    constructor(message, code, context) {
        super(message);
        this.code = code;
        this.context = context;
        this.name = 'SwarmError';
    }
}
export class AgentRegistrationError extends SwarmError {
    constructor(message, context) {
        super(message, 'AGENT_REGISTRATION_ERROR', context);
        this.name = 'AgentRegistrationError';
    }
}
export class TaskAssignmentError extends SwarmError {
    constructor(message, context) {
        super(message, 'TASK_ASSIGNMENT_ERROR', context);
        this.name = 'TaskAssignmentError';
    }
}
export class ConsensusError extends SwarmError {
    constructor(message, context) {
        super(message, 'CONSENSUS_ERROR', context);
        this.name = 'ConsensusError';
    }
}
// ============================================================================
// Swarm Mesh Orchestrator
// ============================================================================
export class SwarmMeshOrchestrator extends EventEmitter {
    agents = new Map();
    tasks = new Map();
    heartbeatTimers = new Map();
    biddingTimers = new Map();
    logger;
    config;
    metrics;
    isRunning = false;
    constructor(config = {}) {
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
    initializeMetrics() {
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
    setupEventHandlers() {
        this.on('agent:registered', (agent) => {
            this.logger.info('Agent registered', { agentId: agent.id, role: agent.role });
        });
        this.on('agent:failed', (agentId, reason) => {
            this.logger.error('Agent failed', { agentId, reason });
            this.handleAgentFailure(agentId, reason).catch((error) => {
                this.logger.error('Failed to handle agent failure', { error });
            });
        });
        this.on('task:assigned', (taskId, agentId) => {
            this.logger.info('Task assigned', { taskId, agentId });
        });
        this.on('task:completed', (taskId) => {
            this.logger.info('Task completed', { taskId });
            this.updateMetricsOnTaskCompletion(taskId);
        });
        this.on('task:failed', (taskId, reason) => {
            this.logger.error('Task failed', { taskId, reason });
        });
    }
    async start() {
        if (this.isRunning) {
            this.logger.warn('Swarm orchestrator is already running');
            return;
        }
        this.logger.info('Starting Swarm Mesh Orchestrator', { config: this.config });
        this.isRunning = true;
        this.emit('swarm:started');
    }
    async shutdown() {
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
    async registerAgent(role, capabilities, endpoint, metadata = {}) {
        try {
            const agentId = randomUUID();
            const agent = {
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
        }
        catch (error) {
            const err = error;
            throw new AgentRegistrationError(`Failed to register agent: ${err.message}`, {
                role,
                error: err.message,
            });
        }
    }
    async deregisterAgent(agentId) {
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
    async updateAgentHeartbeat(agentId) {
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
    startHeartbeatMonitor(agentId) {
        const timer = setInterval(() => {
            this.checkAgentHeartbeat(agentId).catch((error) => {
                this.logger.error('Heartbeat check failed', { agentId, error });
            });
        }, this.config.heartbeatInterval);
        this.heartbeatTimers.set(agentId, timer);
    }
    async checkAgentHeartbeat(agentId) {
        const agent = this.agents.get(agentId);
        if (!agent)
            return;
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
    async handleAgentFailure(agentId, reason) {
        const agent = this.agents.get(agentId);
        if (!agent)
            return;
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
    getAgent(agentId) {
        return this.agents.get(agentId);
    }
    getAgentsByRole(role) {
        return Array.from(this.agents.values()).filter((agent) => agent.role === role);
    }
    getAgentsByStatus(status) {
        return Array.from(this.agents.values()).filter((agent) => agent.status === status);
    }
    // ============================================================================
    // Task Management
    // ============================================================================
    async submitTask(type, description, requirements, astMetadata, priority = 5, deadline = null) {
        try {
            const taskId = randomUUID();
            const task = {
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
        }
        catch (error) {
            const err = error;
            throw new TaskAssignmentError(`Failed to submit task: ${err.message}`, {
                type,
                error: err.message,
            });
        }
    }
    async initiateBiddingProcess(taskId) {
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
    async requestBidsFromAgents(task) {
        const eligibleAgents = this.findEligibleAgents(task);
        this.logger.debug('Requesting bids from eligible agents', {
            taskId: task.id,
            eligibleAgentCount: eligibleAgents.length,
        });
        const bidPromises = eligibleAgents.map((agent) => this.requestBidFromAgent(agent, task).catch((error) => {
            this.logger.warn('Failed to get bid from agent', {
                agentId: agent.id,
                taskId: task.id,
                error,
            });
            return null;
        }));
        await Promise.all(bidPromises);
    }
    findEligibleAgents(task) {
        return Array.from(this.agents.values()).filter((agent) => {
            // Agent must be idle or in standby
            if (agent.status !== AgentStatus.IDLE &&
                agent.status !== AgentStatus.STANDBY) {
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
            const hasRequiredSkills = task.astMetadata.requiredSkills.every((skill) => agent.capabilities.specializations.includes(skill));
            return hasRequiredSkills;
        });
    }
    async requestBidFromAgent(agent, task) {
        try {
            // Calculate confidence score based on agent metrics and task metadata
            const confidenceScore = this.calculateConfidenceScore(agent, task);
            // Estimate completion time based on complexity and agent history
            const estimatedCompletionTime = this.estimateCompletionTime(agent, task);
            const bid = {
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
        }
        catch (error) {
            const err = error;
            this.logger.error('Failed to generate bid', {
                agentId: agent.id,
                taskId: task.id,
                error: err.message,
            });
            return null;
        }
    }
    calculateConfidenceScore(agent, task) {
        let score = 0;
        // Base score from success rate
        score += agent.metrics.successRate * 0.4;
        // Complexity match
        const complexityRatio = Math.min(1, agent.capabilities.maxComplexity / task.astMetadata.complexity);
        score += complexityRatio * 0.3;
        // Experience factor
        const experienceFactor = Math.min(1, agent.metrics.tasksCompleted / 100);
        score += experienceFactor * 0.2;
        // Uptime reliability
        score += (agent.metrics.uptimePercentage / 100) * 0.1;
        return Math.max(0, Math.min(1, score));
    }
    estimateCompletionTime(agent, task) {
        const baseTime = task.astMetadata.estimatedEffort * 3600000; // hours to ms
        const agentEfficiency = agent.metrics.successRate;
        const complexityMultiplier = 1 + task.astMetadata.complexity / 100;
        return baseTime * complexityMultiplier * (2 - agentEfficiency);
    }
    generateProposedApproach(agent, task) {
        return `${agent.role} approach: Analyze ${task.type} with focus on ${task.requirements.join(', ')}. ` +
            `Utilizing ${agent.capabilities.specializations.slice(0, 3).join(', ')} expertise. ` +
            `Complexity level: ${task.astMetadata.complexity}/100.`;
    }
    generateBidReasoning(agent, task, confidenceScore) {
        return `Agent ${agent.id} (${agent.role}) confidence: ${(confidenceScore * 100).toFixed(1)}%. ` +
            `Success rate: ${(agent.metrics.successRate * 100).toFixed(1)}%. ` +
            `Completed ${agent.metrics.tasksCompleted} tasks. ` +
            `Specializations match: ${task.astMetadata.requiredSkills.join(', ')}.`;
    }
    async closeBiddingAndAssign(taskId) {
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
        }
        catch (error) {
            const err = error;
            this.logger.error('Failed to assign task after consensus', {
                taskId,
                error: err.message,
            });
            task.status = TaskStatus.FAILED;
            this.emit('task:failed', taskId, err.message);
        }
    }
    async runConsensusAlgorithm(task) {
        const startTime = Date.now();
        try {
            let winningBid;
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
        }
        catch (error) {
            const err = error;
            throw new ConsensusError(`Consensus failed: ${err.message}`, {
                taskId: task.id,
                algorithm: this.config.consensusAlgorithm,
                bidCount: task.bids.length,
            });
        }
    }
    consensusHighestBid(bids) {
        return bids.reduce((highest, current) => current.confidenceScore > highest.confidenceScore ? current : highest);
    }
    consensusWeightedScore(bids, task) {
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
            const score = bid.confidenceScore * confidenceWeight +
                normalizedTime * timeWeight +
                agent.metrics.successRate * reliabilityWeight +
                priorityBonus * priorityWeight;
            return { bid, score };
        });
        const winner = scoredBids.reduce((highest, current) => current.score > highest.score ? current : highest);
        return winner.bid;
    }
    async consensusRaftLeader(bids) {
        // Simplified Raft-inspired leader election
        // In production, this would implement full Raft consensus
        const sortedBids = [...bids].sort((a, b) => {
            const agentA = this.agents.get(a.agentId);
            const agentB = this.agents.get(b.agentId);
            if (!agentA || !agentB)
                return 0;
            // Leader score based on uptime and success rate
            const scoreA = agentA.metrics.uptimePercentage * agentA.metrics.successRate;
            const scoreB = agentB.metrics.uptimePercentage * agentB.metrics.successRate;
            return scoreB - scoreA;
        });
        return sortedBids[0];
    }
    async assignTaskToAgent(taskId, agentId) {
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
    async assignStandbyAgents(task) {
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
    async executeTask(taskId) {
        const task = this.tasks.get(taskId);
        if (!task)
            return;
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
            const agent = this.agents.get(task.assignedAgentId);
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
        }
        catch (error) {
            const err = error;
            await this.handleTaskFailure(taskId, err.message);
        }
    }
    async simulateTaskExecution(task) {
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
    async handleTaskFailure(taskId, reason) {
        const task = this.tasks.get(taskId);
        if (!task)
            return;
        this.logger.error('Task execution failed', { taskId, reason });
        task.context.previousAttempts.push({
            agentId: task.assignedAgentId,
            failureReason: reason,
            timestamp: Date.now(),
        });
        const agent = this.agents.get(task.assignedAgentId);
        if (agent) {
            agent.status = AgentStatus.IDLE;
            agent.currentTaskId = null;
            agent.metrics.tasksFailedCount++;
        }
        // Check if we should reassign
        if (task.context.previousAttempts.length < this.config.maxReassignmentAttempts) {
            await this.reassignTask(taskId, reason);
        }
        else {
            task.status = TaskStatus.FAILED;
            task.updatedAt = Date.now();
            this.metrics.failedTasks++;
            this.emit('task:failed', taskId, reason);
        }
    }
    async reassignTask(taskId, reason) {
        const task = this.tasks.get(taskId);
        if (!task)
            return;
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
    async findStandbyAgent(task) {
        const standbyAgents = Array.from(this.agents.values()).filter((agent) => agent.status === AgentStatus.STANDBY);
        if (standbyAgents.length === 0)
            return null;
        // Find standby agent that previously bid on this task
        const previousBidder = standbyAgents.find((agent) => task.bids.some((bid) => bid.agentId === agent.id));
        return previousBidder || standbyAgents[0];
    }
    async releaseStandbyAgents(taskId) {
        for (const agent of this.agents.values()) {
            if (agent.status === AgentStatus.STANDBY) {
                agent.status = AgentStatus.IDLE;
            }
        }
    }
    updateMetricsOnTaskCompletion(taskId) {
        const task = this.tasks.get(taskId);
        if (!task || !task.completedAt)
            return;
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
    getTask(taskId) {
        return this.tasks.get(taskId);
    }
    getTasksByStatus(status) {
        return Array.from(this.tasks.values()).filter((task) => task.status === status);
    }
    getSwarmMetrics() {
        return { ...this.metrics };
    }
    getAgentMetrics(agentId) {
        return this.agents.get(agentId)?.metrics;
    }
    async getSwarmHealth() {
        const activeAgentRatio = this.metrics.activeAgents / Math.max(1, this.metrics.totalAgents);
        const successRate = this.metrics.completedTasks / Math.max(1, this.metrics.totalTasks);
        let status;
        if (activeAgentRatio > 0.8 && successRate > 0.9) {
            status = 'healthy';
        }
        else if (activeAgentRatio > 0.5 && successRate > 0.7) {
            status = 'degraded';
        }
        else {
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
    getAllAgents() {
        return Array.from(this.agents.values());
    }
    getAllTasks() {
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
    context;
    level;
    constructor(context, level = 'info') {
        this.context = context;
        this.level = level;
    }
    shouldLog(level) {
        const levels = ['debug', 'info', 'warn', 'error'];
        return levels.indexOf(level) >= levels.indexOf(this.level);
    }
    formatMessage(level, message, meta) {
        const timestamp = new Date().toISOString();
        const metaStr = meta ? JSON.stringify(meta, null, 2) : '';
        return `[${timestamp}] [${level.toUpperCase()}] [${this.context}] ${message} ${metaStr}`;
    }
    debug(message, meta) {
        if (this.shouldLog('debug')) {
            console.debug(this.formatMessage('debug', message, meta));
        }
    }
    info(message, meta) {
        if (this.shouldLog('info')) {
            console.info(this.formatMessage('info', message, meta));
        }
    }
    warn(message, meta) {
        if (this.shouldLog('warn')) {
            console.warn(this.formatMessage('warn', message, meta));
        }
    }
    error(message, meta) {
        if (this.shouldLog('error')) {
            console.error(this.formatMessage('error', message, meta));
        }
    }
}
// ============================================================================
// Export
// ============================================================================
export default SwarmMeshOrchestrator;
