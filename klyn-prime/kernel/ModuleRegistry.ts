export interface KernelModule {

  name: string;

  version: string;

  initialize(): Promise<void>;

  shutdown(): Promise<void>;

}


export class ModuleRegistry {

  private modules: KernelModule[] = [];


  add(module: KernelModule) {
    this.modules.push(module);
  }


  async initializeAll() {
    for (const module of this.modules) {
      await module.initialize();
    }
  }


  getModules() {
    return this.modules;
  }

}
