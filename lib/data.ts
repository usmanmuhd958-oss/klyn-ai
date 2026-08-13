import type { Edge, Node } from '@xyflow/react'
import type { AgentNodeData, CodeFile, MemoryEntry, SystemNodeData } from './types'

export const AGENTS: { id: string; label: string; role: string }[] = [
  { id: 'architect', label: 'Architect', role: 'System design & planning' },
  { id: 'coder', label: 'Coding', role: 'Implementation & refactoring' },
  { id: 'tester', label: 'Testing', role: 'Validation & quality scoring' },
  { id: 'debugger', label: 'Debug', role: 'Root cause analysis' },
  { id: 'deployer', label: 'Deployment', role: 'CI/CD & rollback reasoning' },
  { id: 'security', label: 'Security', role: 'Vulnerability detection' },
]

export const INITIAL_NODES: Node<SystemNodeData | AgentNodeData>[] = [
  // ── System nodes ──────────────────────────────────────────────
  {
    id: 'frontend',
    type: 'system',
    position: { x: 40, y: 120 },
    data: {
      label: 'Web Client',
      kind: 'frontend',
      detail: 'Next.js 15 · React 19 · RSC',
      metrics: [
        { label: 'LCP', value: '0.9s' },
        { label: 'Routes', value: '24' },
      ],
      fileId: 'workspace-shell',
    },
  },
  {
    id: 'api',
    type: 'system',
    position: { x: 380, y: 40 },
    data: {
      label: 'Gateway API',
      kind: 'api',
      detail: 'Edge runtime · tRPC',
      metrics: [
        { label: 'p95', value: '38ms' },
        { label: 'RPS', value: '1.2k' },
      ],
      fileId: 'gateway',
    },
  },
  {
    id: 'backend',
    type: 'system',
    position: { x: 380, y: 260 },
    data: {
      label: 'Agent Runtime',
      kind: 'backend',
      detail: 'Orchestrator · Swarm engine',
      metrics: [
        { label: 'Workers', value: '12' },
        { label: 'Queue', value: '3' },
      ],
      fileId: 'orchestrator',
    },
  },
  {
    id: 'database',
    type: 'system',
    position: { x: 730, y: 150 },
    data: {
      label: 'Neural Store',
      kind: 'database',
      detail: 'Postgres · pgvector',
      metrics: [
        { label: 'Vectors', value: '2.4M' },
        { label: 'Conn', value: '18/100' },
      ],
      fileId: 'vector-query',
    },
  },
  {
    id: 'testing',
    type: 'system',
    position: { x: 40, y: 380 },
    data: {
      label: 'Test Harness',
      kind: 'testing',
      detail: 'Vitest · Playwright',
      metrics: [
        { label: 'Pass', value: '412/418' },
        { label: 'Cov', value: '87%' },
      ],
    },
  },
  {
    id: 'deployment',
    type: 'system',
    position: { x: 730, y: 400 },
    data: {
      label: 'Deploy Plane',
      kind: 'deployment',
      detail: 'Vercel · 3 environments',
      metrics: [
        { label: 'Prod', value: 'v4.2.0' },
        { label: 'Uptime', value: '99.99%' },
      ],
    },
  },
  // ── Agent nodes ───────────────────────────────────────────────
  {
    id: 'agent-architect',
    type: 'agent',
    position: { x: 220, y: -140 },
    data: { agentId: 'architect', label: 'Architect', role: 'System design & planning' },
  },
  {
    id: 'agent-coder',
    type: 'agent',
    position: { x: 460, y: -140 },
    data: { agentId: 'coder', label: 'Coding', role: 'Implementation & refactoring' },
  },
  {
    id: 'agent-security',
    type: 'agent',
    position: { x: 700, y: -140 },
    data: { agentId: 'security', label: 'Security', role: 'Vulnerability detection' },
  },
  {
    id: 'agent-tester',
    type: 'agent',
    position: { x: 40, y: 560 },
    data: { agentId: 'tester', label: 'Testing', role: 'Validation & quality scoring' },
  },
  {
    id: 'agent-debugger',
    type: 'agent',
    position: { x: 380, y: 560 },
    data: { agentId: 'debugger', label: 'Debug', role: 'Root cause analysis' },
  },
  {
    id: 'agent-deployer',
    type: 'agent',
    position: { x: 730, y: 560 },
    data: { agentId: 'deployer', label: 'Deployment', role: 'CI/CD & rollback reasoning' },
  },
]

export const INITIAL_EDGES: Edge[] = [
  { id: 'e-fe-api', source: 'frontend', target: 'api', animated: true },
  { id: 'e-api-be', source: 'api', target: 'backend', animated: true },
  { id: 'e-api-db', source: 'api', target: 'database', animated: true },
  { id: 'e-be-db', source: 'backend', target: 'database', animated: true },
  { id: 'e-be-deploy', source: 'backend', target: 'deployment' },
  { id: 'e-test-fe', source: 'testing', target: 'frontend' },
  { id: 'e-test-be', source: 'testing', target: 'backend' },
  { id: 'e-deploy-db', source: 'database', target: 'deployment' },
  // Agent reasoning links
  { id: 'e-arch-api', source: 'agent-architect', target: 'api', style: { strokeDasharray: '2 4', stroke: 'rgba(102,252,241,0.18)' } },
  { id: 'e-coder-be', source: 'agent-coder', target: 'backend', style: { strokeDasharray: '2 4', stroke: 'rgba(102,252,241,0.18)' } },
  { id: 'e-sec-db', source: 'agent-security', target: 'database', style: { strokeDasharray: '2 4', stroke: 'rgba(102,252,241,0.18)' } },
  { id: 'e-test-test', source: 'agent-tester', target: 'testing', style: { strokeDasharray: '2 4', stroke: 'rgba(102,252,241,0.18)' } },
  { id: 'e-debug-be', source: 'agent-debugger', target: 'backend', style: { strokeDasharray: '2 4', stroke: 'rgba(102,252,241,0.18)' } },
  { id: 'e-deploy-deploy', source: 'agent-deployer', target: 'deployment', style: { strokeDasharray: '2 4', stroke: 'rgba(102,252,241,0.18)' } },
]

export const CODE_FILES: Record<string, CodeFile> = {
  'workspace-shell': {
    id: 'workspace-shell',
    path: 'apps/web/workspace/shell.tsx',
    language: 'typescript',
    content: `import { SpatialCanvas } from './spatial-canvas'
import { useWorkspace } from './use-workspace'

export function WorkspaceShell() {
  const { nodes, agents, sync } = useWorkspace()

  return (
    <main className="workspace-root">
      <SpatialCanvas
        nodes={nodes}
        agents={agents}
        onMutation={sync}
      />
    </main>
  )
}`,
  },
  gateway: {
    id: 'gateway',
    path: 'services/gateway/router.ts',
    language: 'typescript',
    content: `import { router, procedure } from './trpc'
import { agentEvents } from './events'

export const appRouter = router({
  dispatch: procedure
    .input(intentSchema)
    .mutation(async ({ input, ctx }) => {
      const plan = await ctx.brain.plan(input.intent)
      return agentEvents.emit('plan.created', plan)
    }),
})`,
    suggestion: {
      description: 'Security Agent: add rate limiting to the dispatch procedure to prevent intent flooding.',
      original: `  dispatch: procedure
    .input(intentSchema)`,
      replacement: `  dispatch: procedure
    .use(rateLimit({ window: '10s', max: 20 }))
    .input(intentSchema)`,
    },
  },
  orchestrator: {
    id: 'orchestrator',
    path: '1.brain/orchestrator.ts',
    language: 'typescript',
    content: `import { AgentSwarm } from './swarm'
import { GraphMemory } from './graph_memory'

export class Orchestrator {
  private swarm = new AgentSwarm()
  private memory = new GraphMemory()

  async execute(plan: EngineeringPlan) {
    const context = await this.memory.recall(plan.domain)

    for (const task of plan.tasks) {
      const agent = this.swarm.assign(task)
      const result = await agent.run(task, context)
      await this.memory.learn(result)
    }
  }
}`,
    suggestion: {
      description: 'Architect Agent: parallelize independent tasks instead of sequential execution — 3.2x faster plan completion.',
      original: `    for (const task of plan.tasks) {
      const agent = this.swarm.assign(task)
      const result = await agent.run(task, context)
      await this.memory.learn(result)
    }`,
      replacement: `    const layers = topoSort(plan.tasks)
    for (const layer of layers) {
      const results = await Promise.all(
        layer.map((task) =>
          this.swarm.assign(task).run(task, context),
        ),
      )
      await this.memory.learnBatch(results)
    }`,
    },
  },
  'vector-query': {
    id: 'vector-query',
    path: 'db/queries/recall.sql',
    language: 'sql',
    content: `-- Neural memory recall: nearest engineering decisions
SELECT
  id,
  title,
  decision,
  1 - (embedding <=> $1) AS similarity
FROM engineering_memory
WHERE project_id = $2
ORDER BY embedding <=> $1
LIMIT 12;`,
    suggestion: {
      description: 'Coding Agent: add an HNSW index scan hint and similarity floor — recall latency drops from 140ms to 9ms.',
      original: `WHERE project_id = $2
ORDER BY embedding <=> $1
LIMIT 12;`,
      replacement: `WHERE project_id = $2
  AND 1 - (embedding <=> $1) > 0.62
ORDER BY embedding <=> $1
LIMIT 12; -- uses idx_memory_embedding_hnsw`,
    },
  },
}

export const MEMORY_ENTRIES: MemoryEntry[] = [
  {
    id: 'm1',
    kind: 'decision',
    title: 'Adopted CRDT sync over OT',
    detail: 'Yjs chosen for conflict-free offline-first collaboration. OT rejected: server authority conflicts with local-first goal.',
    ago: '2d ago',
    links: ['frontend', 'backend'],
  },
  {
    id: 'm2',
    kind: 'solution',
    title: 'pgvector HNSW recall optimization',
    detail: 'Similarity floor + HNSW index reduced neural recall from 140ms to 9ms across 2.4M vectors.',
    ago: '3d ago',
    links: ['database'],
  },
  {
    id: 'm3',
    kind: 'pattern',
    title: 'Agent task parallelization',
    detail: 'Topological sort of plan graph enables layer-parallel agent execution. Now default for all plans.',
    ago: '5d ago',
    links: ['backend'],
  },
  {
    id: 'm4',
    kind: 'evolution',
    title: 'Debug agent learned N+1 signature',
    detail: 'After resolving 3 incidents, debug agent auto-detects N+1 query patterns from trace shape alone.',
    ago: '1w ago',
    links: ['database', 'api'],
  },
  {
    id: 'm5',
    kind: 'decision',
    title: 'Edge runtime for gateway',
    detail: 'Gateway moved to edge: p95 dropped 210ms to 38ms. Rollback plan retained in deploy plane.',
    ago: '2w ago',
    links: ['api', 'deployment'],
  },
]
