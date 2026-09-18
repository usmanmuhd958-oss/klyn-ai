import type { AIProviderRouter } from "../router.js";
export interface AgentTask<T = string> {
    id: string;
    role: string;
    instruction: string;
    parse?: (output: string) => T;
}
export interface AgentResult<T = string> {
    taskId: string;
    role: string;
    output: T;
}
export interface SwarmOptions {
    concurrency?: number;
    failFast?: boolean;
}
export declare class AgentSwarmCoordinator {
    private readonly router;
    private readonly options;
    constructor(router: AIProviderRouter, options?: SwarmOptions);
    run<T = string>(tasks: AgentTask<T>[]): Promise<AgentResult<T>[]>;
}
//# sourceMappingURL=coordinator.d.ts.map