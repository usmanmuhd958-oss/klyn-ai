export class KlynKernel {

  private modules: Map<string, unknown>;

  constructor() {
    this.modules = new Map();
  }


  register(name: string, module: unknown) {
    this.modules.set(name, module);
  }


  resolve<T>(name: string): T | undefined {
    return this.modules.get(name) as T | undefined;
  }


  listModules(): string[] {
    return Array.from(this.modules.keys());
  }


  status() {
    return {
      name: "KLYN Prime Kernel",
      modules: this.modules.size,
      state: "running"
    };
  }

}
