import { QuantumZkLedger } from '../security/quantum_zk.js';
import type { ExperienceLearner } from '../../../1.brain/experience_learner.js';
import type { AdaptivePolicyEngine } from '../../../1.brain/adaptive_policy.js';
import type { FleetOrchestrator, FleetNodeState } from '../../../packages/swarm-mesh/src/fleet_orchestrator.js';

export interface EngineLedger {
  append(stream: string, record: unknown): Promise<unknown>;
  readAll(stream: string): Promise<unknown[]>;
}

export type PolicyPersistEvent =
  | { type: 'observe'; success: boolean; latencyMs?: number }
  | { type: 'activate'; draft: unknown; baseline?: { successRate?: number; avgLatencyMs?: number } };

export class EnginePersistence {
  constructor(protected readonly ledger: EngineLedger) {}

  async persistQuantumMutation(
    ledger: QuantumZkLedger,
    kind: 'patch' | 'state' | 'event',
    ref: string,
    input: string,
    output: string,
    meta: Record<string, unknown> = {}
  ): Promise<void> {
    await this.ledger.append('quantum', { type: 'mutation', kind, ref, input, output, meta });
  }

  async restoreQuantum(ledger: QuantumZkLedger): Promise<number> {
    const events = await this.ledger.readAll('quantum');
    let restored = 0;
    for (const event of events) {
      const e = event as { type: string; kind?: 'patch' | 'state' | 'event'; ref?: string; input?: string; output?: string; meta?: Record<string, unknown> };
      if (e.type !== 'mutation') continue;
      if (!e.kind || typeof e.ref !== 'string' || typeof e.input !== 'string' || typeof e.output !== 'string') continue;
      ledger.commitMutation(e.kind, e.ref, e.input, e.output, e.meta ?? {});
      restored++;
    }
    return restored;
  }

  async persistLearnerRecord(
    learner: ExperienceLearner,
    scope: string,
    key: string,
    success: boolean,
    latencyMs?: number,
    detail?: string
  ): Promise<void> {
    await this.ledger.append('experience', { type: 'record', scope, key, success, latencyMs, detail });
  }

  async restoreLearner(learner: ExperienceLearner): Promise<number> {
    const events = await this.ledger.readAll('experience');
    let restored = 0;
    for (const event of events) {
      const e = event as { type: string; scope?: string; key?: string; success?: boolean; latencyMs?: number; detail?: string };
      if (e.type !== 'record' || typeof e.scope !== 'string' || typeof e.key !== 'string' || typeof e.success !== 'boolean') continue;
      learner.record(e.scope, e.key, e.success, e.latencyMs, e.detail);
      restored++;
    }
    return restored;
  }

  async persistPolicyEvent(policy: AdaptivePolicyEngine, event: PolicyPersistEvent): Promise<void> {
    await this.ledger.append('policy', event);
  }

  async restorePolicy(policy: AdaptivePolicyEngine): Promise<number> {
    const events = await this.ledger.readAll('policy');
    let restored = 0;
    for (const event of events) {
      const e = event as PolicyPersistEvent;
      if (e.type === 'observe') {
        policy.observe(e.success, e.latencyMs);
        restored++;
      } else if (e.type === 'activate' && typeof e.draft === 'object' && e.draft !== null) {
        policy.activate(e.draft as Parameters<AdaptivePolicyEngine['activate']>[0], e.baseline);
        restored++;
      }
    }
    return restored;
  }

  async persistFleet(fleet: FleetOrchestrator): Promise<void> {
    const nodes = fleet.snapshotNodes();
    await this.ledger.append('fleet', { type: 'snapshot', nodes, at: Date.now() });
  }

  async restoreFleet(fleet: FleetOrchestrator): Promise<number> {
    const events = await this.ledger.readAll('fleet');
    let restored = 0;
    for (const event of events) {
      const e = event as { type: string; nodes?: FleetNodeState[] };
      if (e.type !== 'snapshot' || !Array.isArray(e.nodes)) continue;
      fleet.restoreNodes(e.nodes);
      restored += e.nodes.length;
    }
    return restored;
  }
}
