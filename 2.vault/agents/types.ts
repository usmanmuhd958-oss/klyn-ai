// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
/**
 * KLYN AI OS - Agent Swarm Type Definitions
 */

import type { LLMRequest, LLMResponse, ModelName } from '../1.brain/types.ts';

export type AgentRole = 'architect' | 'coder' | 'auditor' | 'reviewer' | 'orchestrator';

export type MessageType = 
  | 'task_assignment'
  | 'task_result'
  | 'question'
  | 'answer'
  | 'collaboration_request'
  | 'status_update'
  | 'error';

export interface AgentMessage {
  id: string;
  from: AgentRole;
  to: AgentRole | 'broadcast';
  type: MessageType;
  content: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
  conversationId?: string;
  replyTo?: string;
}

export interface Task {
  id: string;
  type: TaskType;
  description: string;
  context: TaskContext;
  priority: 'low' | 'medium' | 'high' | 'critical';
  deadline?: Date;
  assignedTo?: AgentRole;
  status: TaskStatus;
  dependencies?: string[]; // Task IDs
  result?: TaskResult;
  createdAt: Date;
  completedAt?: Date;
}

export type TaskType =
  | 'analyze_requirements'
  | 'design_architecture'
  | 'generate_code'
  | 'write_tests'
  | 'security_audit'
  | 'code_review'
  | 'refactor'
  | 'documentation'
  | 'debug';

export type TaskStatus = 
  | 'pending'
  | 'assigned'
  | 'in_progress'
  | 'blocked'
  | 'completed'
  | 'failed';

export interface TaskContext {
  projectName?: string;
  files?: FileContext[];
  requirements?: string;
  constraints?: string[];
  existingCode?: string;
  testFramework?: string;
  targetRuntime?: string;
}

export interface FileContext {
  path: string;
  content: string;
  language: string;
  ast?: ASTNode;
}

export interface TaskResult {
  success: boolean;
  output: string;
  artifacts?: Artifact[];
  issues?: Issue[];
  metadata?: Record<string, unknown>;
}

export interface Artifact {
  type: 'code' | 'test' | 'documentation' | 'diagram' | 'report';
  name: string;
  content: string;
  language?: string;
  path?: string;
}

export interface Issue {
  severity: 'info' | 'warning' | 'error' | 'critical';
  type: string;
  message: string;
  location?: {
    file: string;
    line: number;
    column: number;
  };
  suggestion?: string;
}

export interface AgentCapability {
  role: AgentRole;
  name: string;
  description: string;
  preferredModel: ModelName;
  taskTypes: TaskType[];
  maxConcurrentTasks: number;
}

export interface ASTNode {
  type: string;
  name?: string;
  start: number;
  end: number;
  children?: ASTNode[];
  metadata?: Record<string, unknown>;
}

export interface SwarmMetrics {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  averageCompletionTime: number;
  totalCost: number;
  agentUtilization: Record<AgentRole, number>;
  tasksByType: Record<TaskType, number>;
}

export interface WorkflowStep {
  id: string;
  agent: AgentRole;
  task: TaskType;
  description: string;
  dependsOn?: string[];
  optional?: boolean;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  metadata?: Record<string, unknown>;
}
