/**
 * KLYN PRIME
 * Meta Intelligence Orchestrator
 *
 * Central coordination layer for autonomous intelligence.
 */

export interface IntelligenceModule {
    name: string;
    status: "active" | "idle" | "failed";
    execute(input: IntelligenceRequest): Promise<IntelligenceResponse>;
}

export interface IntelligenceRequest {
    id: string;
    objective: string;
    context?: Record<string, unknown>;
    priority?: number;
}

export interface IntelligenceResponse {
    module: string;
    result: unknown;
    confidence: number;
    timestamp: number;
}


export class MetaIntelligenceOrchestrator {

    private modules: Map<string, IntelligenceModule>;
    private history: IntelligenceResponse[];

    constructor() {
        this.modules = new Map();
        this.history = [];
    }


    registerModule(module: IntelligenceModule): void {

        this.modules.set(module.name, module);

        console.log(
            `[META] Registered intelligence module: ${module.name}`
        );
    }


    async reason(
        request: IntelligenceRequest
    ): Promise<IntelligenceResponse[]> {

        const responses: IntelligenceResponse[] = [];

        for (const module of this.modules.values()) {

            if (module.status !== "active") {
                continue;
            }

            try {

                const response =
                    await module.execute(request);

                responses.push(response);

                this.history.push(response);

            } catch(error) {

                console.error(
                    `[META ERROR] ${module.name}`,
                    error
                );

            }
        }


        return this.synthesize(responses);
    }



    private synthesize(
        responses: IntelligenceResponse[]
    ): IntelligenceResponse[] {


        return responses.sort(
            (a,b) =>
                b.confidence - a.confidence
        );

    }



    getIntelligenceState() {

        return {

            modules:
                Array.from(
                    this.modules.keys()
                ),

            totalDecisions:
                this.history.length,

            system:
                "KLYN META INTELLIGENCE ACTIVE"

        };

    }

}
