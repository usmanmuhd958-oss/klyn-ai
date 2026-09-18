export class GovernanceGraphEngine {
    state;
    constructor(initialInvariants) {
        this.state = {
            currentStage: 'INITIALIZED',
            invariants: initialInvariants,
            evidence: new Map(),
        };
    }
    getStage() {
        return this.state.currentStage;
    }
    addEvidence(evidence) {
        if (this.state.currentStage === 'TERMINATED') {
            throw new Error('Cannot add evidence to a terminated governance graph.');
        }
        this.state.evidence.set(evidence.invariantId, evidence);
    }
    evaluateStageTransition() {
        const stageOrder = [
            'INITIALIZED',
            'POLICY_EVALUATED',
            'INVARIANTS_VERIFIED',
            'ATTESTED',
            'TERMINATED',
        ];
        const currentIndex = stageOrder.indexOf(this.state.currentStage);
        if (currentIndex === stageOrder.length - 1) {
            return this.state.currentStage;
        }
        const nextStage = stageOrder[currentIndex + 1];
        const requiredInvariants = this.state.invariants
            .filter((inv) => inv.requiredForStage === nextStage)
            .sort((a, b) => a.id.localeCompare(b.id));
        for (const inv of requiredInvariants) {
            const ev = this.state.evidence.get(inv.id);
            if (!ev || !ev.verified) {
                return this.state.currentStage;
            }
        }
        if (nextStage) {
            this.state.currentStage = nextStage;
        }
        return this.state.currentStage;
    }
}
//# sourceMappingURL=graph.js.map