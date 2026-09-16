export class SystemHealthSnapshot {
  capture() {
    return {
      health: "ONLINE",
      timestamp: new Date().toISOString()
    };
  }
}
