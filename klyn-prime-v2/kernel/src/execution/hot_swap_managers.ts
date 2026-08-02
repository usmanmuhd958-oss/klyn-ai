import { KlynModule } from "../../core/contracts/ModuleContract";
import { EventBus } from "../../core/events/EventBus";
import { KlynEvent } from "../../core/contracts/EventContract";

export interface SwapResult<T extends KlynModule> {
    success: boolean;
    previousModule: T | undefined;
    error?: Error;
}

export class HotSwapManager {
    private registry: Map<string, KlynModule> = new Map();
    private eventBus: EventBus;
    private abortControllers: Map<string, AbortController> = new Map();
    private swapLocks: Set<string> = new Set();

    constructor(eventBus: EventBus) {
        this.eventBus = eventBus;
    }

    register(module: KlynModule): void {
        this.registry.set(module.name, module);
    }

    unregister(name: string): boolean {
        const existing = this.registry.get(name);
        if (existing !== undefined) {
            this.registry.delete(name);
        }
        const controller = this.abortControllers.get(name);
        if (controller !== undefined) {
            controller.abort();
            this.abortControllers.delete(name);
        }
        return existing !== undefined;
    }

    get<T extends KlynModule>(name: string): T | undefined {
        return this.registry.get(name) as T | undefined;
    }

    async swap<T extends KlynModule>(name: string, newModule: T): Promise<SwapResult<T>> {
        if (this.swapLocks.has(name)) {
            return {
                success: false,
                previousModule: this.get(name),
                error: new Error(`Module ${name} is already being swapped`)
            };
        }

        this.swapLocks.add(name);

        try {
            const result = await this.executeSwap(name, newModule);
            return result;
        } finally {
            this.swapLocks.delete(name);
        }
    }

    private async executeSwap<T extends KlynModule>(
        name: string,
        newModule: T
    ): Promise<SwapResult<T>> {
        const previous = this.registry.get(name) as T | undefined;

        const oldController = this.abortControllers.get(name);
        if (oldController) {
            oldController.abort(new Error(`Module ${name} is being hot-swapped`));
            this.abortControllers.delete(name);
        }

        const newController = new AbortController();
        this.abortControllers.set(name, newController);

        try {
            if (previous?.shutdown) {
                await Promise.race([
                    previous.shutdown(),
                    new Promise<never>((_, reject) =>
                        setTimeout(() => reject(new Error(`Shutdown timeout for ${name}`)), 5000)
                    )
                ]);
            }
        } catch (shutdownError) {
            this.eventBus.publish({
                type: "module.swap.warning",
                payload: { module: name, error: shutdownError }
            } as KlynEvent);
        }

        this.registry.set(name, newModule);

        try {
            await Promise.race([
                newModule.initialize(),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error(`Initialization timeout for ${name}`)), 10000)
                )
            ]);
        } catch (initError) {
            if (previous) {
                this.registry.set(name, previous);
            } else {
                this.registry.delete(name);
            }
            if (oldController) {
                this.abortControllers.set(name, oldController);
            } else {
                this.abortControllers.delete(name);
            }
            return { success: false, previousModule: previous, error: initError as Error };
        }

        return { success: true, previousModule: previous };
    }

    getAbortSignal(name: string): AbortSignal | undefined {
        return this.abortControllers.get(name)?.signal;
    }

    list(): string[] {
        return Array.from(this.registry.keys());
    }

    dispose(): void {
        for (const [name, controller] of this.abortControllers) {
            controller.abort();
            this.abortControllers.delete(name);
        }
        this.registry.clear();
        this.swapLocks.clear();
    }
}