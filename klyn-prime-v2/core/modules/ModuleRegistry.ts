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
    for (const module of this.modules.values()) {
      await module.initialize();
    }
  }

  list(): string[] {
    return Array.from(this.modules.keys());
  }
}
