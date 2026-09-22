export interface ServiceLifecycle {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export class ServiceLifecycleManager {

  private services: ServiceLifecycle[] = [];

  register(service: ServiceLifecycle) {
    this.services.push(service);
  }

  async startAll() {
    for (const service of this.services) {
      await service.start();
    }

    return {
      status: "STARTED",
      services: this.services.length
    };
  }

  async stopAll() {
    for (const service of [...this.services].reverse()) {
      await service.stop();
    }

    return {
      status: "STOPPED"
    };
  }
}
