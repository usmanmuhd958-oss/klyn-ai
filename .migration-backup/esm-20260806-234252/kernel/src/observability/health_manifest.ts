'use strict';

export const SYSTEM_HEALTH = Object.freeze({
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  FAULTED: 'FAULTED',
  TERMINATED: 'TERMINATED',
});

class Manifest {
  components: Record<string, any> = {};

  register(name: string, opts: any = {}) {
    this.components[name] = { status: 'HEALTHY', ...opts };
  }

  setDegraded(name: string, meta: any = {}) {
    if (this.components[name]) {
      this.components[name] = { ...this.components[name], status: 'DEGRADED', ...meta };
    }
  }

  setHealthy(name: string, meta: any = {}) {
    if (this.components[name]) {
      this.components[name] = { ...this.components[name], status: 'HEALTHY', ...meta };
    }
  }

  setTerminated(name: string, meta: any = {}) {
    if (this.components[name]) {
      this.components[name] = { ...this.components[name], status: 'TERMINATED', ...meta };
    }
  }

  updateMetrics(name: string, metrics: Record<string, any> = {}) {
    if (this.components[name]) {
      this.components[name] = {
        ...this.components[name],
        metrics: { ...(this.components[name].metrics || {}), ...metrics },
      };
    }
  }

  snapshot() {
    const components = { ...this.components };
    const statuses = Object.values(components).map((c) => c.status);
    const systemHealth = statuses.length === 0
      ? SYSTEM_HEALTH.HEALTHY
      : statuses.every((s) => s === SYSTEM_HEALTH.HEALTHY)
        ? SYSTEM_HEALTH.HEALTHY
        : statuses.includes(SYSTEM_HEALTH.TERMINATED)
          ? SYSTEM_HEALTH.TERMINATED
          : statuses.includes(SYSTEM_HEALTH.FAULTED)
            ? SYSTEM_HEALTH.FAULTED
            : SYSTEM_HEALTH.DEGRADED;
    return { components, systemHealth };
  }
}

let instance: Manifest | null = null;

export function getManifest(): Manifest {
  if (!instance) instance = new Manifest();
  return instance;
}
