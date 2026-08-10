export class CoreModuleRegistry {
  private modules = new Map<string, any>();

  register(name: string, module: any) {
    this.modules.set(name, module);
  }

  getAll() {
    return Array.from(this.modules.keys());
  }
}
