export class PlatformOrchestrator {
  constructor(private runtime: any) {}

  async boot() {
    return this.runtime.start();
  }
}
