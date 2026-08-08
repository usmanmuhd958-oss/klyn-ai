/**
 * =============================================================================
 * KLYN AI OS — Genesis V670 — Component 07: AdaptiveRealityEngine
 * File: genesis/v670/components/AdaptiveRealityEngine.ts
 * Version: 1.0.0
 *
 * The reality plane of the V670 runtime. Wraps the real world-model layers:
 *   - world-model/reality/RealityEngine (observed reality snapshots)
 *   - world-model/state/ProjectState (project entities)
 *   - world-model/graph/DependencyGraph (dependency relations)
 *   - world-model/graph/KnowledgeGraph (typed knowledge)
 *   - world-model/graph/ImpactGraph (change impact analysis)
 *
 * Publishes 'reality.observed' snapshots that the CrossRealityRuntimeEngine
 * and FutureRuntimeSimulator consume.
 * =============================================================================
 */

import { RealityEngine, type RealitySnapshot } from '../../../world-model/reality/RealityEngine.js';
import { ProjectState, type ProjectEntity } from '../../../world-model/state/ProjectState.js';
import { DependencyGraph, type DependencyRelation } from '../../../world-model/graph/DependencyGraph.js';
import { KnowledgeGraph, type KnowledgeNode, type KnowledgeEdge } from '../../../world-model/graph/KnowledgeGraph.js';
import { ImpactGraph, type ImpactReport } from '../../../world-model/graph/ImpactGraph.js';
import { moduleMetrics, type ModuleMetrics, type RuntimeContext, type V670Module, type V670Status } from '../types.js';

export interface ObservedReality extends RealitySnapshot {
  knowledgeNodes: number;
  knowledgeEdges: number;
  relations: number;
  impactRisk: number;
}

export class AdaptiveRealityEngine implements V670Module {
  [key: string]: any;
  readonly id = 'adaptive-reality';
  readonly name = 'Adaptive Reality Engine';
  status: V670Status = 'registered';
  lastError: string | null = null;
  startedAt: number | null = null;

  private ctx: RuntimeContext | null = null;
  private state: ProjectState;
  private dependencies: DependencyGraph;
  private knowledge: KnowledgeGraph;
  private reality: RealityEngine;
  private impact: ImpactGraph;
  private lastSnapshot: ObservedReality | null = null;
  private observations = 0;
  private lastObserveMs = 0;

  constructor() {
    this.state = new ProjectState();
    this.dependencies = new DependencyGraph();
    this.knowledge = new KnowledgeGraph();
    this.reality = new RealityEngine(this.state, this.dependencies);
    this.impact = new ImpactGraph(this.dependencies);
  }

  public register(ctx: RuntimeContext): void {
    this.ctx = ctx;
    // Consume graph relations published by other components.
    this.ctx.subscribe('graph.relation', (event) => {
      const relation = (event.payload as { relation?: DependencyRelation }).relation;
      if (relation) this.dependencies.addRelation(relation);
    });
    this.ctx.subscribe('graph.node', (event) => {
      const node = (event.payload as { node?: KnowledgeNode }).node;
      if (node) this.knowledge.addNode(node);
    });
  }

  public async start(ctx: RuntimeContext): Promise<void> {
    this.startedAt = Date.now();
    this.status = 'running';
    this.observe();
    ctx.logger.info('adaptive reality engine online');
  }

  /** Observe the current reality and publish the snapshot. */
  public observe(): ObservedReality {
    const base = this.reality.observe();
    const observed: ObservedReality = {
      ...base,
      knowledgeNodes: this.knowledge.nodeCount,
      knowledgeEdges: this.knowledge.edgeCount,
      relations: this.dependencies.relationCount,
      impactRisk: this.impactRisk(),
    };
    this.lastSnapshot = observed;
    this.observations++;
    this.lastObserveMs = Date.now();
    this.ctx?.publish('reality.observed', { snapshot: observed }, this.id);
    return observed;
  }

  public registerEntity(entity: ProjectEntity): void {
    this.state.register(entity);
    this.observe();
  }

  public removeEntity(id: string): void {
    this.state.remove(id);
    this.observe();
  }

  public addRelation(relation: DependencyRelation): void {
    this.dependencies.addRelation(relation);
    this.observe();
  }

  public connectKnowledge(edge: KnowledgeEdge): void {
    this.knowledge.connect(edge);
    this.observe();
  }

  public addKnowledgeNode(node: KnowledgeNode): void {
    this.knowledge.addNode(node);
    this.observe();
  }

  /** Analyze change impact for a node via the real ImpactGraph. */
  public analyzeImpact(root: string): ImpactReport {
    return this.impact.analyze(root);
  }

  public getDependencyGraph(): DependencyGraph {
    return this.dependencies;
  }

  public getKnowledgeGraph(): KnowledgeGraph {
    return this.knowledge;
  }

  public getLastSnapshot(): ObservedReality | null {
    return this.lastSnapshot;
  }

  public async stop(): Promise<void> {
    this.status = 'stopped';
  }

  public async dispose(): Promise<void> {
    this.status = 'stopped';
  }

  public metrics(): ModuleMetrics {
    return moduleMetrics(
      this.id,
      this.name,
      this.status,
      this.startedAt,
      { observations: this.observations },
      {
        entities: this.state.list().length,
        relations: this.dependencies.relationCount,
        knowledgeNodes: this.knowledge.nodeCount,
        knowledgeEdges: this.knowledge.edgeCount,
        lastObserveMs: this.lastObserveMs,
      },
      this.lastError
    );
  }

  private impactRisk(): number {
    const entities = this.state.list();
    let risk = 0;
    for (const entity of entities) {
      const report = this.impact.analyze(entity.id);
      risk = Math.max(risk, report.affectedNodes.length);
    }
    return risk;
  }
}

export default AdaptiveRealityEngine;
