/**
 * Klyn Studio Core Type Definitions
 *
 * Defines the contract between:
 * - Frontend Workspace
 * - Agent Runtime
 * - AI Gateway
 * - Execution Engine
 */

export type AgentStatus =
  | "idle"
  | "thinking"
  | "planning"
  | "executing"
  | "reviewing"
  | "completed"
  | "failed";

export type AgentRole =
  | "architect"
  | "backend-engineer"
  | "frontend-engineer"
  | "database-engineer"
  | "security-agent"
  | "tester"
  | "devops"
  | "researcher";

export type ExecutionEventType =
  | "agent.started"
  | "agent.thinking"
  | "agent.tool_call"
  | "agent.completed"
  | "agent.failed"
  | "file.created"
  | "file.updated"
  | "file.deleted"
  | "terminal.command"
  | "workflow.started"
  | "workflow.completed"
  | "system";

export type WorkspaceView =
  | "editor"
  | "orchestra"
  | "graph"
  | "timeline"
  | "terminal";

/**
 * AI Agent representation
 */
export interface StudioAgent {
  id: string;
  name: string;
  role: AgentRole;
  status: AgentStatus;
  currentTask?: string;
  description?: string;

  /**
   * Runtime metrics
   */
  tokensUsed: number;
  latencyMs?: number;
  startedAt?: number;
  completedAt?: number;

  /**
   * Collaboration graph
   */
  connectedAgents: string[];

  metadata?: Record<string, unknown>;
}

/**
 * Agent communication edge
 */
export interface AgentConnection {
  sourceAgentId: string;
  targetAgentId: string;
  relation:
    | "delegates"
    | "communicates"
    | "reviews"
    | "depends";
  createdAt: number;
}

/**
 * Code file loaded inside Monaco
 */
export interface WorkspaceFile {
  id: string;
  path: string;
  name: string;
  language: string;
  content: string;
  modified: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * Monaco editor tab
 */
export interface EditorTab {
  fileId: string;
  active: boolean;
  pinned?: boolean;
}

/**
 * Runtime execution event
 */
export interface ExecutionEvent {
  id: string;
  type: ExecutionEventType;
  timestamp: number;
  agentId?: string;
  message: string;

  /**
   * AI context snapshot
   */
  context?: {
    prompt?: string;
    tokens?: number;
    model?: string;
  };

  /**
   * Code mutation information
   */
  diff?: {
    filePath: string;
    additions?: number;
    deletions?: number;
  };

  metadata?: Record<string, unknown>;
}

/**
 * Agent swarm global state
 */
export interface AgentSwarmState {
  agents: StudioAgent[];
  connections: AgentConnection[];
  activeAgentId?: string;
}

/**
 * Command Palette action
 */
export interface StudioCommand {
  id: string;
  name: string;
  description?: string;
  shortcut?: string;
  category:
    | "workspace"
    | "agent"
    | "navigation"
    | "system";
  execute: () => void;
}

/**
 * Complete Studio State
 */
export interface StudioState {
  files: WorkspaceFile[];
  activeFileId?: string;
  tabs: EditorTab[];
  swarm: AgentSwarmState;
  timeline: ExecutionEvent[];
  currentView: WorkspaceView;
  connected: boolean;
}
