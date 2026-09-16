import type { ToolAuditRecord } from "./hermetic-tool-contracts.js";

export interface AgentTrajectoryAuditLink {
  readonly stepId: string;
  readonly agentId: string;
  readonly intentId: string;
  readonly auditHash: string;
  readonly auditSequence: number;
}

export class AgentTrajectoryAuditLedger {
  private readonly links: AgentTrajectoryAuditLink[] = [];
  private readonly stepIds = new Set<string>();

  record(stepId: string, audit: ToolAuditRecord): AgentTrajectoryAuditLink {
    if (!stepId) throw new Error("stepId is required");
    if (this.stepIds.has(stepId)) throw new Error(`Duplicate agent trajectory step: ${stepId}`);
    const previous = this.links[this.links.length - 1];
    if (previous && audit.previousAuditHash !== previous.auditHash) {
      throw new Error(`Tool audit chain discontinuity at agent step: ${stepId}`);
    }
    const link: AgentTrajectoryAuditLink = Object.freeze({
      stepId,
      agentId: audit.agentId,
      intentId: audit.intentId,
      auditHash: audit.auditHash,
      auditSequence: audit.sequence,
    });
    this.stepIds.add(stepId);
    this.links.push(link);
    return link;
  }

  snapshot(): readonly AgentTrajectoryAuditLink[] {
    return this.links.map((link) => ({ ...link }));
  }
}
