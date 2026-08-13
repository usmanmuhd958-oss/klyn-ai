export type NodeStatus = 'healthy' | 'active' | 'warning' | 'building' | 'idle'

export type AgentStatus = 'idle' | 'planning' | 'executing' | 'verifying'

export type LogLevel = 'info' | 'agent' | 'success' | 'warn' | 'error' | 'system'

export interface LogEntry {
  id: string
  ts: number
  level: LogLevel
  source: string
  message: string
}

export interface AgentState {
  status: AgentStatus
  task: string | null
  progress: number
}

export interface SystemNodeData {
  label: string
  kind: 'frontend' | 'backend' | 'database' | 'api' | 'deployment' | 'testing'
  detail: string
  metrics: { label: string; value: string }[]
  fileId?: string
  [key: string]: unknown
}

export interface AgentNodeData {
  agentId: string
  label: string
  role: string
  [key: string]: unknown
}

export interface CodeFile {
  id: string
  path: string
  language: 'typescript' | 'sql'
  content: string
  suggestion?: {
    description: string
    original: string
    replacement: string
  }
}

export interface ScenarioStep {
  delay: number
  log?: { level: LogLevel; source: string; message: string }
  agent?: { id: string; status: AgentStatus; task?: string | null; progress?: number }
  node?: { id: string; status: NodeStatus }
  openFile?: string
}

export interface Scenario {
  id: string
  title: string
  hint: string
  steps: ScenarioStep[]
}

export interface MemoryEntry {
  id: string
  kind: 'decision' | 'solution' | 'pattern' | 'evolution'
  title: string
  detail: string
  ago: string
  links: string[]
}
