/**
 * KLYN AI OS - Architect Agent
 * Powered by GPT-5.6 Sol for system design
 */

import { BaseAgent } from './base_agent.ts';
import type { Task, TaskResult, AgentCapability, Artifact } from './types.ts';
import type { CognitiveRouter } from '../1.brain/cognitive_router.ts';
import type { GraphMemory } from '../1.brain/graph_memory.ts';

export class ArchitectAgent extends BaseAgent {
  constructor(router: CognitiveRouter, memory: GraphMemory) {
    const capability: AgentCapability = {
      role: 'architect',
      name: 'System Architect',
      description: 'Designs system architecture, module interfaces, and dependency graphs',
      preferredModel: 'gpt-5.6-sol',
      taskTypes: ['analyze_requirements', 'design_architecture'],
      maxConcurrentTasks: 3,
    };

    super(capability, router, memory);
  }

  async executeTask(task: Task): Promise<TaskResult> {
    console.log(`[Architect] 🏗️  Processing: ${task.description}`);

    switch (task.type) {
      case 'analyze_requirements':
        return await this.analyzeRequirements(task);
      case 'design_architecture':
        return await this.designArchitecture(task);
      default:
        throw new Error(`Unsupported task type: ${task.type}`);
    }
  }

  private async analyzeRequirements(task: Task): Promise<TaskResult> {
    const context = await this.retrieveContext(task.description);
    
    const prompt = `
As a senior system architect, analyze these requirements and produce a detailed technical specification.

Requirements:
${task.context.requirements || task.description}

${context ? `Relevant context from knowledge base:\n${context}` : ''}

Provide:
1. Core functional requirements
2. Non-functional requirements (performance, security, scalability)
3. Technical constraints
4. Recommended technology stack
5. High-level component breakdown
6. Risk assessment

Format as structured markdown.
    `.trim();

    const analysis = await this.query(prompt, 'architecture');

    // Store in memory
    this.storeKnowledge('decision', `requirements_${task.id}`, analysis, {
      taskId: task.id,
      type: 'requirements_analysis',
    });

    return {
      success: true,
      output: analysis,
      artifacts: [
        {
          type: 'documentation',
          name: 'requirements_analysis.md',
          content: analysis,
        },
      ],
    };
  }

  private async designArchitecture(task: Task): Promise<TaskResult> {
    const context = await this.retrieveContext(task.description);
    
    const prompt = `
Design a production-grade system architecture for the following project.

Project: ${task.context.projectName || 'Unnamed Project'}
Requirements: ${task.context.requirements || task.description}
Constraints: ${task.context.constraints?.join(', ') || 'None specified'}
Target Runtime: ${task.context.targetRuntime || 'Node.js/Termux'}

${context ? `Context:\n${context}` : ''}

Provide:
1. **System Architecture Diagram** (ASCII/Mermaid)
2. **Module Breakdown** with responsibilities
3. **Interface Definitions** (types/APIs)
4. **Data Flow** description
5. **Dependency Graph**
6. **File Structure** recommendation
7. **Integration Points**

Be specific and production-ready. Think like a principal engineer.
    `.trim();

    const architecture = await this.query(prompt, 'architecture');

    // Extract module interfaces
    const interfacePrompt = `
Based on this architecture:

${architecture}

Generate TypeScript interface definitions for all major modules.
Include:
- Type definitions
- Function signatures
- Class structures
- API contracts

Provide compilable TypeScript code.
    `.trim();

    const interfaces = await this.query(interfacePrompt, 'architecture');

    // Store in memory
    const archId = this.storeKnowledge('decision', `architecture_${task.id}`, architecture, {
      taskId: task.id,
      type: 'system_architecture',
      projectName: task.context.projectName,
    });

    this.storeKnowledge('file', 'types.ts', interfaces, {
      language: 'typescript',
      generatedBy: 'architect',
    });

    const artifacts: Artifact[] = [
      {
        type: 'documentation',
        name: 'architecture.md',
        content: architecture,
      },
      {
        type: 'code',
        name: 'types.ts',
        content: interfaces,
        language: 'typescript',
      },
    ];

    // Generate dependency graph
    const depGraph = this.generateDependencyGraph(architecture);
    if (depGraph) {
      artifacts.push({
        type: 'diagram',
        name: 'dependency_graph.mmd',
        content: depGraph,
      });
    }

    return {
      success: true,
      output: architecture,
      artifacts,
      metadata: { architectureId: archId },
    };
  }

  private generateDependencyGraph(architecture: string): string | null {
    // Extract module names and dependencies from architecture text
    // This is a simplified version; real implementation would use NLP
    return `
graph TD
    A[Core Engine] --> B[LLM Gateway]
    A --> C[Graph Memory]
    D[Agent Swarm] --> A
    D --> B
    E[Orchestrator] --> D
    E --> C
    `.trim();
  }

  protected getDefaultSystemPrompt(): string {
    return `You are an expert system architect with 15+ years of experience designing scalable, production-grade systems. You specialize in:
- Microservices and distributed systems
- Event-driven architectures
- Mobile-edge computing
- TypeScript/Node.js ecosystems
- Real-time systems
- Security-first design

You provide detailed, actionable architecture designs with clear module boundaries, interface definitions, and dependency management. You think about performance, scalability, maintainability, and developer experience.`;
  }
}
