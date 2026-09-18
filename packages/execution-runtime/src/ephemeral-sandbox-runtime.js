import { ResourceBoundaryEnforcer } from "./resource-boundary-enforcer.js";
import { RuntimeSnapshotEngine } from "./runtime-snapshot-engine.js";
import { ProcessSandboxManager } from "./process-sandbox-manager.js";
export class EphemeralSandboxRuntime {
    enforcer;
    processSandbox;
    snapshots;
    constructor(options = {}) {
        this.enforcer = new ResourceBoundaryEnforcer(options.resourcePolicy);
        this.processSandbox = new ProcessSandboxManager(options.processPolicy);
        this.snapshots = options.snapshotEngine ?? new RuntimeSnapshotEngine();
    }
    async execute(request) {
        const workspace = this.enforcer.validate(request);
        this.enforcer.assertRuntimeLimits(request.timeoutMs ?? 30_000, request.memoryMb ?? 512);
        const snapshot = await this.snapshots.create(workspace);
        try {
            const result = await this.processSandbox.execute({
                ...request,
                cwd: workspace,
                fenceKey: request.fenceKey ?? workspace,
                ownerId: request.ownerId ?? `sandbox-${Date.now()}`,
            });
            if (result.exitCode !== 0 || result.timedOut || result.memoryExceeded || result.signal !== null) {
                await this.snapshots.rollback(snapshot);
            }
            return result;
        }
        catch (error) {
            await this.snapshots.rollback(snapshot);
            throw error;
        }
        finally {
            await this.snapshots.discard(snapshot);
        }
    }
}
//# sourceMappingURL=ephemeral-sandbox-runtime.js.map