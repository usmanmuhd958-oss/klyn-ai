export class EnterpriseRuntimeManager {
  async start() {
    return { status: "runtime-online" };
  }

  async stop() {
    return { status: "runtime-stopped" };
  }
}
