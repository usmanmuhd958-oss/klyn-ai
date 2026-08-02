import { PrimeRegistry } from "../registry/PrimeRegistry";
import { NexusBus } from "../communication/NexusBus";
import { NexusOrchestrator } from "../orchestration/NexusOrchestrator";
import { SystemHealth } from "../health/SystemHealth";
import { IntelligenceTelemetry } from "../telemetry/IntelligenceTelemetry";

export class NexusKernel {

    private registry: PrimeRegistry;
    private bus: NexusBus;
    private orchestrator: NexusOrchestrator;
    private health: SystemHealth;
    private telemetry: IntelligenceTelemetry;

    private memoryThresholdMB: number;
    private gcInterval: ReturnType<typeof setInterval> | null = null;


    constructor(memoryThresholdMB: number = 512) {

        this.registry = new PrimeRegistry();
        this.bus = new NexusBus();
        this.health = new SystemHealth();
        this.telemetry = new IntelligenceTelemetry();

        this.orchestrator =
            new NexusOrchestrator(
                this.registry,
                this.bus
            );

        this.memoryThresholdMB = memoryThresholdMB;
    }


    async boot(){

        this.applyGCTuning();

        this.startMemoryMonitoring();

        console.log(
            "[NEXUS] Booting Prime Intelligence Kernel..."
        );

        this.health.initialize();

        this.telemetry.record(
            "kernel_boot",
            {
                timestamp:
                    Date.now(),
                memoryThresholdMB: this.memoryThresholdMB
            }
        );

        await this.orchestrator.initialize();


        console.log(
            "[NEXUS] Kernel online"
        );
    }


    private applyGCTuning(): void {
        if (typeof globalThis.gc === 'function') {
            globalThis.gc();
        }

        if (typeof process !== 'undefined' && process.memoryUsage) {
            const mem = process.memoryUsage();
            const heapUsedMB = mem.heapUsed / 1024 / 1024;

            if (heapUsedMB > this.memoryThresholdMB * 0.8) {
                console.log(`[NEXUS] Pre-boot GC: heap at ${heapUsedMB.toFixed(1)}MB`);
                if (typeof globalThis.gc === 'function') {
                    globalThis.gc();
                }
            }
        }
    }


    private startMemoryMonitoring(): void {
        if (typeof process === 'undefined' || !process.memoryUsage) {
            return;
        }

        this.gcInterval = setInterval(() => {
            const mem = process.memoryUsage();
            const heapUsedMB = mem.heapUsed / 1024 / 1024;
            const heapTotalMB = mem.heapTotal / 1024 / 1024;
            const ratio = heapUsedMB / heapTotalMB;

            if (ratio > 0.9) {
                console.log(`[NEXUS] Critical memory pressure: ${heapUsedMB.toFixed(1)}MB / ${heapTotalMB.toFixed(1)}MB`);
                this.registry.list().forEach(id => {
                    this.telemetry.record("memory_pressure", { moduleId: id, heapUsedMB });
                });

                if (typeof globalThis.gc === 'function') {
                    globalThis.gc();
                }
            }
        }, 30000);
    }


    getMemoryStats(): { heapUsedMB: number; heapTotalMB: number; rssMB: number } | null {
        if (typeof process === 'undefined' || !process.memoryUsage) {
            return null;
        }

        const mem = process.memoryUsage();
        return {
            heapUsedMB: mem.heapUsed / 1024 / 1024,
            heapTotalMB: mem.heapTotal / 1024 / 1024,
            rssMB: mem.rss / 1024 / 1024
        };
    }


    getRegistry(){
        return this.registry;
    }


    getBus(){
        return this.bus;
    }


    async shutdown(): Promise<void> {
        if (this.gcInterval) {
            clearInterval(this.gcInterval);
            this.gcInterval = null;
        }

        if (typeof globalThis.gc === 'function') {
            globalThis.gc();
        }

        console.log("[NEXUS] Kernel shutdown complete");
    }

}
