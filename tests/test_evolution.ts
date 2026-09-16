import { getEvolutionEngine } from '../kernel/src/execution/evolution_engine.js';
import os from 'node:os';
import path from 'node:path';

const engine = getEvolutionEngine();
engine.propose({
    targetFile: path.join(os.homedir(), 'klyn-ai-os', 'test.js'),
    patchContent: 'console.log("evolution test");',
    reason: 'automated test',
    requesterId: 'test_runner'
}).then(console.log).catch(console.error);


export {};
