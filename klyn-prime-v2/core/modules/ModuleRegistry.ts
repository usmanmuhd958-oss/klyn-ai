import { KlynModule } from "../contracts/ModuleContract";

export class ModuleRegistry {

  private modules: Map<string, KlynModule> = new Map();


  register(module: KlynModule): void {
    this.modules.set(module.name, module);
  }


  get(name: string): KlynModule | undefined {
    return this.modules.get(name);
  }


  async initializeAll(): Promise<void> {
    const errors: Error[] = [];

    for (const module of this.modules.values()) {
      try {
        await module.initialize();
      } catch (error) {
        errors.push(error as Error);
      }
    }

    if (errors.length > 0) {
      throw new Error(
        `Module initialization failed for: ${errors.map(e => e.message).join(", ")}`
      );
    }
  }


  list(): string[] {
    return Array.from(this.modules.keys());
  }


  async shutdownAll(): Promise<void> {
    const errors: Error[] = [];

    for (const module of this.modules.values()) {
      try {
        await module.shutdown();
      } catch (error) {
        errors.push(error as Error);
      }
    }

    if (errors.length > 0) {
      console.error("[ModuleRegistry] Shutdown errors:", errors);
    }
  }


  unregister(name: string): boolean {
    return this.modules.delete(name);
  }

}
