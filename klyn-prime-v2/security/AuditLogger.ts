export interface AuditEvent {
  timestamp: number;
  principal: string;
  action: string;
  resource: string;
  outcome: 'success' | 'failure' | 'denied';
  metadata?: Record<string, unknown>;
}

export class AuditLogger {
  private static instance: AuditLogger;
  private events: AuditEvent[] = [];
  private maxEvents: number;

  private constructor(maxEvents: number = 10000) {
    this.maxEvents = maxEvents;
  }

  static getInstance(maxEvents?: number): AuditLogger {
    if (!AuditLogger.instance) {
      AuditLogger.instance = new AuditLogger(maxEvents);
    }
    return AuditLogger.instance;
  }

  log(event: Omit<AuditEvent, 'timestamp'>): void {
    const fullEvent: AuditEvent = {
      ...event,
      timestamp: Date.now(),
    };

    this.events.push(fullEvent);

    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }

    if (fullEvent.outcome === 'failure' || fullEvent.outcome === 'denied') {
      console.error(`[AUDIT] ${fullEvent.outcome.toUpperCase()}: ${fullEvent.action} on ${fullEvent.resource} by ${fullEvent.principal}`);
    }
  }

  getEvents(filter?: {
    principal?: string;
    action?: string;
    outcome?: AuditEvent['outcome'];
    since?: number;
  }): AuditEvent[] {
    let result = this.events;

    if (filter) {
      if (filter.principal) {
        result = result.filter(e => e.principal === filter.principal);
      }
      if (filter.action) {
        result = result.filter(e => e.action === filter.action);
      }
      if (filter.outcome) {
        result = result.filter(e => e.outcome === filter.outcome);
      }
      if (filter.since) {
        result = result.filter(e => e.timestamp >= filter.since!);
      }
    }

    return result;
  }

  getSecurityMetrics(): {
    totalEvents: number;
    failureCount: number;
    deniedCount: number;
    topActions: Array<{ action: string; count: number }>;
    topPrincipals: Array<{ principal: string; count: number }>;
  } {
    const actionCounts = new Map<string, number>();
    const principalCounts = new Map<string, number>();
    let failures = 0;
    let denied = 0;

    for (const event of this.events) {
      actionCounts.set(event.action, (actionCounts.get(event.action) || 0) + 1);
      principalCounts.set(event.principal, (principalCounts.get(event.principal) || 0) + 1);

      if (event.outcome === 'failure') failures++;
      if (event.outcome === 'denied') denied++;
    }

    const topActions = Array.from(actionCounts.entries())
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const topPrincipals = Array.from(principalCounts.entries())
      .map(([principal, count]) => ({ principal, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalEvents: this.events.length,
      failureCount: failures,
      deniedCount: denied,
      topActions,
      topPrincipals,
    };
  }

  clear(): void {
    this.events = [];
  }
}
