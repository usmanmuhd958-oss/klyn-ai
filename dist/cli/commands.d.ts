import { KlynEngine } from '../engine/klyn_engine.js';
export declare class CLICommands {
    private engine;
    constructor(engine: KlynEngine);
    index(path: string): Promise<void>;
    query(path: string): void;
    dependencies(path: string, depth?: number): void;
    impact(path: string): void;
    search(pattern: string, limit?: number): void;
    stats(): void;
}
//# sourceMappingURL=commands.d.ts.map