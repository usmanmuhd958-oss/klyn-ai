import type { ExecutionPhase } from './phases';

export type AgentRole = 'planner' | 'builder' | 'validator' | 'shipper';

export type TaskStatus = 'pending' | 'running' | 'done';

export interface EngineeringTask {
  id: string;
  title: string;
  phase: ExecutionPhase;
  agent: AgentRole;
  dependsOn: string[];
  status: TaskStatus;
}

export function decomposeIntent(intent: string): EngineeringTask[] {
  const t = (
    id: string,
    title: string,
    phase: ExecutionPhase,
    agent: AgentRole,
    dependsOn: string[] = []
  ): EngineeringTask => ({ id, title, phase, agent, dependsOn, status: 'pending' });

  return [
    t('map-context', `Map system context for "${intent}"`, 'Thinking', 'planner'),
    t('identify-gap', 'Identify architectural gap', 'Thinking', 'planner', ['map-context']),
    t('draft-architecture', 'Draft structural change proposal', 'Planning', 'planner', ['identify-gap']),
    t('risk-review', 'Validate plan against constraints', 'Planning', 'validator', ['draft-architecture']),
    t('synthesize-modules', 'Synthesize module changes', 'Building', 'builder', ['risk-review']),
    t('wire-integrations', 'Wire cross-module integrations', 'Building', 'builder', ['risk-review']),
    t('verify-behavior', 'Verify behavior in sandbox', 'Testing', 'validator', [
      'synthesize-modules',
      'wire-integrations',
    ]),
    t('ship', 'Ship through delivery pipeline', 'Deploying', 'shipper', ['verify-behavior']),
    t('record-adr', 'Record ADR and update digital twin', 'Learning', 'planner', ['ship']),
  ];
}

export function readyTasks(tasks: EngineeringTask[]): EngineeringTask[] {
  const done = new Set(tasks.filter((t) => t.status === 'done').map((t) => t.id));
  return tasks.filter(
    (t) => t.status === 'pending' && t.dependsOn.every((dep) => done.has(dep))
  );
}
