import type { Scenario } from './types'

export const SCENARIOS: Scenario[] = [
  {
    id: 'optimize-database',
    title: 'Optimize database',
    hint: 'Coding + Debug agents analyze query plans and vector indexes',
    steps: [
      { delay: 0, log: { level: 'system', source: 'brain', message: 'Intent received: "optimize database" — routing to Debug + Coding agents' }, agent: { id: 'debugger', status: 'planning', task: 'Analyzing query telemetry', progress: 10 } },
      { delay: 900, node: { id: 'database', status: 'active' }, log: { level: 'agent', source: 'debug', message: 'Scanning 48h of query telemetry on neural store…' } },
      { delay: 1800, agent: { id: 'debugger', status: 'executing', task: 'Tracing slow recall queries', progress: 45 }, log: { level: 'warn', source: 'debug', message: 'Found: memory recall p95 at 140ms — sequential scan on embedding column' } },
      { delay: 1400, agent: { id: 'coder', status: 'planning', task: 'Drafting index strategy', progress: 20 }, log: { level: 'agent', source: 'coding', message: 'Proposing HNSW index + similarity floor for db/queries/recall.sql' } },
      { delay: 1600, openFile: 'vector-query', agent: { id: 'coder', status: 'executing', task: 'Rewriting recall query', progress: 70 }, log: { level: 'info', source: 'coding', message: 'Inline suggestion staged in recall.sql — awaiting review (Tab to accept)' } },
      { delay: 1800, agent: { id: 'debugger', status: 'verifying', task: 'Benchmarking patched query', progress: 90 }, log: { level: 'agent', source: 'debug', message: 'Benchmark: recall latency 140ms → 9ms (-93.5%)' } },
      { delay: 1500, agent: { id: 'debugger', status: 'idle', task: null, progress: 0 }, node: { id: 'database', status: 'healthy' }, log: { level: 'success', source: 'brain', message: 'Database optimization complete. Learning stored in neural memory.' } },
      { delay: 400, agent: { id: 'coder', status: 'idle', task: null, progress: 0 } },
    ],
  },
  {
    id: 'security-audit',
    title: 'Find security issues',
    hint: 'Security agent sweeps every surface for vulnerabilities',
    steps: [
      { delay: 0, log: { level: 'system', source: 'brain', message: 'Intent received: "find security issues" — dispatching Security agent' }, agent: { id: 'security', status: 'planning', task: 'Mapping attack surface', progress: 15 } },
      { delay: 1100, node: { id: 'api', status: 'active' }, log: { level: 'agent', source: 'security', message: 'Auditing gateway procedures, auth flows, dependency graph…' } },
      { delay: 1900, node: { id: 'database', status: 'active' }, agent: { id: 'security', status: 'executing', task: 'Deep scanning gateway', progress: 55 }, log: { level: 'warn', source: 'security', message: 'CVE-2025-1182: transitive dep in gateway — patched version available' } },
      { delay: 1400, node: { id: 'api', status: 'warning' }, log: { level: 'error', source: 'security', message: 'dispatch procedure has no rate limiting — intent flooding possible' } },
      { delay: 1500, openFile: 'gateway', agent: { id: 'security', status: 'executing', task: 'Staging rate limit patch', progress: 80 }, log: { level: 'info', source: 'security', message: 'Fix staged in services/gateway/router.ts — awaiting review' } },
      { delay: 1800, agent: { id: 'security', status: 'verifying', task: 'Re-running audit', progress: 95 }, node: { id: 'database', status: 'healthy' }, log: { level: 'agent', source: 'security', message: 'Re-audit clean: 0 critical, 1 advisory. Compliance score 98/100' } },
      { delay: 1300, agent: { id: 'security', status: 'idle', task: null, progress: 0 }, node: { id: 'api', status: 'healthy' }, log: { level: 'success', source: 'brain', message: 'Security sweep complete. 2 issues resolved, signatures learned.' } },
    ],
  },
  {
    id: 'deploy-production',
    title: 'Deploy production',
    hint: 'Deployment agent runs tests, ships, and watches for rollback',
    steps: [
      { delay: 0, log: { level: 'system', source: 'brain', message: 'Intent received: "deploy production" — Testing gate required first' }, agent: { id: 'tester', status: 'executing', task: 'Running full test suite', progress: 30 } },
      { delay: 1200, node: { id: 'testing', status: 'building' }, log: { level: 'agent', source: 'testing', message: 'Running 418 tests across unit, integration, e2e…' } },
      { delay: 2200, agent: { id: 'tester', status: 'idle', task: null, progress: 0 }, node: { id: 'testing', status: 'healthy' }, log: { level: 'success', source: 'testing', message: '418/418 passed · coverage 87% · quality score 9.2/10' } },
      { delay: 900, agent: { id: 'deployer', status: 'planning', task: 'Reasoning about environments', progress: 25 }, log: { level: 'agent', source: 'deploy', message: 'Canary strategy selected: 5% → 50% → 100% with auto-rollback' } },
      { delay: 1600, node: { id: 'deployment', status: 'building' }, agent: { id: 'deployer', status: 'executing', task: 'Shipping canary v4.3.0', progress: 60 }, log: { level: 'info', source: 'deploy', message: 'Building v4.3.0 — edge functions compiled in 4.1s' } },
      { delay: 2000, agent: { id: 'deployer', status: 'verifying', task: 'Watching canary metrics', progress: 85 }, log: { level: 'agent', source: 'deploy', message: 'Canary healthy: error rate 0.00%, p95 stable at 38ms' } },
      { delay: 1800, agent: { id: 'deployer', status: 'idle', task: null, progress: 0 }, node: { id: 'deployment', status: 'healthy' }, log: { level: 'success', source: 'deploy', message: 'v4.3.0 live in production. Rollback point retained for 72h.' } },
    ],
  },
  {
    id: 'create-auth',
    title: 'Create authentication system',
    hint: 'Architect plans, Coding implements, Testing validates',
    steps: [
      { delay: 0, log: { level: 'system', source: 'brain', message: 'Intent received: "create authentication system" — multi-agent plan forming' }, agent: { id: 'architect', status: 'planning', task: 'Designing auth architecture', progress: 20 } },
      { delay: 1400, log: { level: 'agent', source: 'architect', message: 'Plan: session-based auth, edge middleware, RLS policies — 7 tasks in 3 layers' } },
      { delay: 1200, node: { id: 'backend', status: 'active' }, agent: { id: 'architect', status: 'idle', task: null, progress: 0 } },
      { delay: 200, agent: { id: 'coder', status: 'executing', task: 'Implementing auth core', progress: 35 }, log: { level: 'agent', source: 'coding', message: 'Writing session manager, middleware, and login surfaces in parallel…' } },
      { delay: 2200, node: { id: 'frontend', status: 'active' }, openFile: 'orchestrator', agent: { id: 'coder', status: 'executing', task: 'Wiring frontend auth state', progress: 70 }, log: { level: 'info', source: 'coding', message: '9 files changed across frontend + backend — diffs staged on canvas' } },
      { delay: 1800, agent: { id: 'tester', status: 'executing', task: 'Generating auth test suite', progress: 50 }, log: { level: 'agent', source: 'testing', message: 'Generated 36 tests: session expiry, CSRF, brute-force lockout…' } },
      { delay: 2000, agent: { id: 'tester', status: 'idle', task: null, progress: 0 }, node: { id: 'frontend', status: 'healthy' }, log: { level: 'success', source: 'testing', message: '36/36 auth tests passed — quality score 9.6/10' } },
      { delay: 600, agent: { id: 'coder', status: 'idle', task: null, progress: 0 }, node: { id: 'backend', status: 'healthy' }, log: { level: 'success', source: 'brain', message: 'Authentication system complete. Architecture decision recorded.' } },
    ],
  },
]

export function getScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id)
}
