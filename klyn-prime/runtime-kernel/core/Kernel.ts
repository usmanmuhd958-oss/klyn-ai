export class KlynKernel {

  private modules: Map<string, unknown>;

  constructor() {
    this.modules = new Map();
  }

  register(name: string, module: unknown) {
    this.modules.set(name, module);
  }

  get(name: string) {
    return this.modules.get(name);
  }

  boot() {
    console.log("[KLYN KERNEL] Booting runtime...");
    console.log(
      `[KLYN KERNEL] Modules: ${this.modules.size}`
    );
  }
}
