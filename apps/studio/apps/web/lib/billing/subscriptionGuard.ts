export type KlynPlan = "free" | "pro" | "team" | "enterprise";

export interface PlanLimits {
  maxAgents: number;
  maxProjects: number;
  monthlyTokens: number;
  advancedVerification: boolean;
  priorityModels: boolean;
}

const PLAN_LIMITS: Record<KlynPlan, PlanLimits> = {
  free: {
    maxAgents: 2,
    maxProjects: 1,
    monthlyTokens: 50000,
    advancedVerification: false,
    priorityModels: false,
  },
  pro: {
    maxAgents: 10,
    maxProjects: 20,
    monthlyTokens: 1000000,
    advancedVerification: true,
    priorityModels: true,
  },
  team: {
    maxAgents: 50,
    maxProjects: 200,
    monthlyTokens: 10000000,
    advancedVerification: true,
    priorityModels: true,
  },
  enterprise: {
    maxAgents: 500,
    maxProjects: Infinity,
    monthlyTokens: Infinity,
    advancedVerification: true,
    priorityModels: true,
  },
};

export function getPlanLimits(plan: KlynPlan): PlanLimits {
  return PLAN_LIMITS[plan];
}

export function canCreateAgent(
  plan: KlynPlan,
  currentAgents: number
): boolean {
  return currentAgents < getPlanLimits(plan).maxAgents;
}

export function canCreateProject(
  plan: KlynPlan,
  currentProjects: number
): boolean {
  return currentProjects < getPlanLimits(plan).maxProjects;
}

export function hasFeature(
  plan: KlynPlan,
  feature: keyof Omit<
    PlanLimits,
    "maxAgents" | "maxProjects" | "monthlyTokens"
  >
): boolean {
  return Boolean(getPlanLimits(plan)[feature]);
}
