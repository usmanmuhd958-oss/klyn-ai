export class BackendRuntime {
  private status = "initialized";

  start() {
    this.status = "running";
    return this.status;
  }
}
