export class ServiceDependencyGraph {
  private services: string[] = [];

  add(service: string) {
    this.services.push(service);
  }

  resolve() {
    return this.services;
  }
}
