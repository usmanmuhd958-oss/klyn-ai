export interface RegisteredModule {
  id: string;
  name: string;
  version: string;
  type: string;
  status: "active" | "inactive" | "failed";
  capabilities: string[];
  metadata?: Record<string, unknown>;
}


export class PrimeRegistry {

  private modules: Map<string, RegisteredModule>;

  constructor() {
    this.modules = new Map();
  }


  register(module: RegisteredModule): void {
    this.modules.set(module.id, module);

    console.log(
      `[REGISTRY] Module registered: ${module.name}`
    );
  }


  unregister(id: string): boolean {

    return this.modules.delete(id);

  }


  get(id: string): RegisteredModule | undefined {

    return this.modules.get(id);

  }


  list(): RegisteredModule[] {

    return Array.from(
      this.modules.values()
    );

  }


  findCapability(capability: string): RegisteredModule[] {

    return this.list().filter(
      module =>
        module.capabilities.includes(capability)
    );

  }


  healthReport() {

    const modules = this.list();

    return {
      total: modules.length,

      active:
        modules.filter(
          m => m.status === "active"
        ).length,

      failed:
        modules.filter(
          m => m.status === "failed"
        ).length
    };

  }

}
