export type GovernanceStage = 'INITIALIZED' | 'POLICY_EVALUATED' | 'INVARIANTS_VERIFIED' | 'ATTESTED' | 'TERMINATED';
export interface InvariantRequirement {
    id: string;
    description: string;
    requiredForStage: GovernanceStage;
}
export interface InvariantEvidence {
    invariantId: string;
    verified: boolean;
    timestamp: number;
}
export interface GovernanceState {
    currentStage: GovernanceStage;
    invariants: InvariantRequirement[];
    evidence: Map<string, InvariantEvidence>;
}
export declare class GovernanceGraphEngine {
    private state;
    constructor(initialInvariants: InvariantRequirement[]);
    getStage(): GovernanceStage;
    addEvidence(evidence: InvariantEvidence): void;
    evaluateStageTransition(): GovernanceStage;
}
//# sourceMappingURL=graph.d.ts.map