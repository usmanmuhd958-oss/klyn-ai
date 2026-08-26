// packages/intent-engine/src/resolver/GoalDecomposer.ts

export interface TechnicalRequirement {
  id: string
  goalId: string
  category: 'architecture' | 'security' | 'data' | 'api' | 'ui' | 'infra' | 'testing'
  title: string
  description: string
  agentType: AgentType
  estimatedComplexity: 'low' | 'medium' | 'high' | 'very-high'
  dependencies: string[] // other requirement IDs
  acceptanceCriteria: string[]
  canvasNodeType: CanvasNodeType // Links requirement to canvas node
}

export class GoalDecomposer {
  decompose(intent: Intent): TechnicalRequirement[] {
    const requirements: TechnicalRequirement[] = []
    
    for (const goal of intent.goals) {
      const goalReqs = this.decomposeGoal(goal, intent)
      requirements.push(...goalReqs)
    }
    
    return this.topologicalSort(requirements) // Order by dependencies
  }

  private decomposeGoal(
    goal: Goal, 
    intent: Intent
  ): TechnicalRequirement[] {
    // Domain-aware decomposition
    // e.g., "fraud detection" →
    //   - ML model serving infrastructure (Data Agent)
    //   - Real-time transaction scoring API (Backend Agent)  
    //   - Feature store database (Data Agent)
    //   - Alert/blocking mechanism (Backend Agent)
    //   - Fraud dashboard UI (Frontend Agent)
    //   - Model monitoring (DevOps Agent)
  }
}