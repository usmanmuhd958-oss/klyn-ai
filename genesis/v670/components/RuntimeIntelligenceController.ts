/**
 * =============================================================================
 * KLYN AI OS — Genesis V670 — Component 05: RuntimeIntelligenceController
 * File: genesis/v670/components/RuntimeIntelligenceController.ts
 * Version: 1.0.0
 *
 * The intelligence plane of the V670 runtime. Wires the real brain layers:
 *   - 1.brain/cognitive_router.ts (CognitiveRouter — intent routing)
 *   - 1.brain/agent_engine.ts (AgentExecutionEngine — autonomous agent)
 *   - 1.brain/scheduler.ts (Scheduler — deferred task execution)
 *   - 1.brain/orchestrator.ts (Hive — multi-agent swarm)
 *   - 1.brain/llm_gateway.ts (LLMGateway — provider abstraction)
 *
 * In `embedded` brain mode all decision paths run offline; in `llm` mode the
 * gateway is consulted. The cognitive router engages when repository context
 * has been ingested (a DAG root is available).
 * =============================================================================
 */

import { CognitiveRouter, type RouteDecision } from '../../../1.brain/cognitive_router.js';
import { AgentExecutionEngine, type AgentQuery } from '../../../1.brain/agent_engine.js';
import { Scheduler } from '../../../1.brain/scheduler.js';
import { Hive, type HiveTaskResult } from '../../../1.brain/orchestrator.js';
import { LLMGateway } from '../../../1.brain/llm_gateway.js';
import { moduleMetrics, type ModuleMetrics, type RuntimeContext, type V670Module, type V670Status } from '../types.js';

export interface RouteOutcome {
  intent: string;
  strategy: string;
  complexity: number;
  source: 'cognitive-router' | 'embedded';
}

export interface ThinkOutcome {
  text: string;
  provider: string;
  model: string;
}

export class RuntimeIntelligenceController implements V670Module {
  [key: string]: any;
  readonly id = 'runtime-intelligence';
  readonly name = 'Runtime Intelligence Controller';
  status: V670Status = 'registered';
  lastError: string | null = null;
  startedAt: number | null = null;

  private ctx: RuntimeContext | null = null;
  private engine: AgentExecutionEngine;
  private scheduler: Scheduler;
  private hive: Hive;
  private gateway: LLMGateway;
  private routerCache: CognitiveRouter | null = null;
  private routes = 0;
  private thoughts = 0;
  private delegations = 0;

  constructor() {
    this.engine = new AgentExecutionEngine();
    this.scheduler = new Scheduler();
    this.hive = new Hive(this.scheduler);
    this.gateway = new LLMGateway();
  }

  public register(ctx: RuntimeContext): void {
    this.ctx = ctx;
    this.ctx.subscribe('v670.think', async (event) => {
      const prompt = (event.payload as { prompt?: string }).prompt;
      if (prompt) {
        const outcome = await this.think(prompt);
        this.ctx!.publish('v670.think.reply', outcome, this.id, event.correlationId ?? undefined);
      }
    });
  }

  public async start(ctx: RuntimeContext): Promise<void> {
    this.startedAt = Date.now();
    this.status = 'running';
    ctx.logger.info(`runtime intelligence online (mode: ${ctx.config.brainMode})`);
  }

  /**
   * Route a query to a strategy. Uses the real CognitiveRouter when the agent
   * engine has ingested a repository (DAG root available), else an embedded
   * offline decision.
   */
  public route(query: string): RouteOutcome {
    this.routes++;
    const dagRoot = this.engine.getDAGRoot();
    if (dagRoot) {
      try {
        if (!this.routerCache) {
          this.routerCache = new CognitiveRouter(dagRoot, this.engine.getDependencyGraph() ?? undefined);
        }
        const decision: RouteDecision = this.routerCache.route(query);
        return {
          intent: decision.intent.type,
          strategy: decision.strategy,
          complexity: decision.estimatedComplexity,
          source: 'cognitive-router',
        };
      } catch {
        /* fall through to embedded */
      }
    }

    return {
      intent: classifyIntent(query),
      strategy: 'direct',
      complexity: query.length > 200 ? 0.8 : 0.3,
      source: 'embedded',
    };
  }

  /** Generate a response: LLM gateway in 'llm' mode, deterministic offline otherwise. */
  public async think(prompt: string): Promise<ThinkOutcome> {
    this.thoughts++;
    const mode = this.ctx?.config.brainMode ?? 'embedded';

    if (mode === 'llm') {
      try {
        const response = await this.gateway.complete(prompt, { provider: 'deepseek' });
        return { text: response.text, provider: response.provider ?? 'deepseek', model: response.model ?? 'unknown' };
      } catch (err) {
        this.lastError = (err as Error).message;
      }
    }

    return {
      text: `[V670-EMBEDDED] intent=${classifyIntent(prompt)} complexity=${prompt.length > 200 ? 'high' : 'low'}`,
      provider: 'embedded',
      model: 'v670-deterministic',
    };
  }

  /** Delegate work to the Hive swarm. */
  public async delegate(kind: string, payload: unknown, timeoutMs?: number): Promise<HiveTaskResult> {
    this.delegations++;
    return this.hive.dispatch(kind, payload, { timeoutMs });
  }

  public registerAgent(id: string, role: string, handler: (task: any) => Promise<unknown> | unknown): void {
    this.hive.registerAgent(id, role, handler);
  }

  /** Execute a full agent cycle (ingest → route → patch) through the real engine. */
  public async executeAgent(query: AgentQuery) {
    return this.engine.execute(query);
  }

  public getHive(): Hive {
    return this.hive;
  }

  public getScheduler(): Scheduler {
    return this.scheduler;
  }

  public getEngine(): AgentExecutionEngine {
    return this.engine;
  }

  public async stop(): Promise<void> {
    this.scheduler.dispose();
    this.status = 'stopped';
  }

  public async dispose(): Promise<void> {
    this.scheduler.dispose();
    this.hive.dispose();
    this.status = 'stopped';
  }

  public metrics(): ModuleMetrics {
    const hiveStats = this.hive.getStats();
    return moduleMetrics(
      this.id,
      this.name,
      this.status,
      this.startedAt,
      {
        routes: this.routes,
        thoughts: this.thoughts,
        delegations: this.delegations,
        hiveTasks: hiveStats.tasksCompleted,
        hiveFaults: hiveStats.totalFaults,
      },
      {
        agents: hiveStats.agents,
        scheduled: hiveStats.pendingScheduled,
        routerEngaged: this.routerCache ? 1 : 0,
      },
      this.lastError
    );
  }
}

// ---------------------------------------------------------------------------
// PRIVATE HELPERS
// ---------------------------------------------------------------------------

function classifyIntent(query: string): string {
  const q = query.toLowerCase();
  if (/(fix|bug|error|fail)/.test(q)) return 'modify';
  if (/(create|new|generate|implement|write)/.test(q)) return 'create';
  if (/(delete|remove|drop)/.test(q)) return 'delete';
  if (/(refactor|optimize|improve|restructure)/.test(q)) return 'refactor';
  if (/(analy|impact|depend|explain|why|how)/.test(q)) return 'analyze';
  return 'read';
}

export default RuntimeIntelligenceController;
