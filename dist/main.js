// src/main.ts
import { KlynEngine } from './engine/klyn_engine.js';
import { CLICommands } from './cli/commands.js';
async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log(`
Klyn AI OS - Next-Generation Local AI Engine

Usage:
  node dist/main.js index <path>              Index a repository
  node dist/main.js query <path>              Query file information
  node dist/main.js deps <path> [depth]       Show dependencies
  node dist/main.js impact <path>             Impact analysis
  node dist/main.js search <pattern> [limit]  Search content
  node dist/main.js stats                     Show statistics
    `);
        process.exit(0);
    }
    const engine = new KlynEngine();
    const cli = new CLICommands(engine);
    const command = args[0];
    try {
        switch (command) {
            case 'index':
                if (!args[1])
                    throw new Error('Path required');
                await cli.index(args[1]);
                break;
            case 'query':
                if (!args[1])
                    throw new Error('Path required');
                cli.query(args[1]);
                break;
            case 'deps':
            case 'dependencies':
                if (!args[1])
                    throw new Error('Path required');
                cli.dependencies(args[1], args[2] ? parseInt(args[2]) : 1);
                break;
            case 'impact':
                if (!args[1])
                    throw new Error('Path required');
                cli.impact(args[1]);
                break;
            case 'search':
                if (!args[1])
                    throw new Error('Pattern required');
                cli.search(args[1], args[2] ? parseInt(args[2]) : 10);
                break;
            case 'stats':
                cli.stats();
                break;
            default:
                console.error(`Unknown command: ${command}`);
                process.exit(1);
        }
    }
    catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}
main();
//# sourceMappingURL=main.js.map