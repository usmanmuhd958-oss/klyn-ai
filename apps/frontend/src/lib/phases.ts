export const EXECUTION_PHASES = [
  'Thinking',
  'Planning',
  'Building',
  'Testing',
  'Deploying',
  'Learning',
] as const;

export type ExecutionPhase = (typeof EXECUTION_PHASES)[number];

export type PhaseStatus = 'pending' | 'active' | 'done';

export const PHASE_DESCRIPTIONS: Record<ExecutionPhase, string> = {
  Thinking: 'Interpreting intent and gathering project context',
  Planning: 'Decomposing into an autonomous execution plan',
  Building: 'Agents writing and refactoring code',
  Testing: 'Verifying behavior in sandboxed runtimes',
  Deploying: 'Shipping through the delivery pipeline',
  Learning: 'Writing outcomes back to architecture memory',
};
