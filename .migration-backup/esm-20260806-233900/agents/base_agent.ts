/**
 * KLYN AI OS - Base Agent
 */

import type { CognitiveRouter } from '../1.brain/cognitive_router.ts';
import type { GraphMemory } from '../1.brain/graph_memory.ts';
import type {
  AgentRole,
  AgentMessage,
  Task,
  TaskResult,
  AgentCapability,
  MessageType,
} from './types.ts';
import { randomUUID } from 'crypto';

export abstract class BaseAgent {
  [key: string]: any;
  protected capability: AgentCapability;
  protected router: CognitiveRouter;
  protected memory: GraphMemory;
  protected messageQueue: AgentMessage[] = [];
  protected activeTasks: Map<string, Task> = new Map();
  protected conversationHistory: Map<string, AgentMessage[]> = new Map();

  constructor(
    capability: AgentCapability,
    router: CognitiveRouter,
    memory: GraphMemory
  ) {
    this.capability = capability;
    this.router = router;
    this.memory = memory;
  }

  /**
   * Process assigned task
   */
  abstract executeTask(task: Task): Promise<TaskResult>;

  /**
   * Receive message from another agent
   */
  async receiveMessage(message: AgentMessage): Promise<void> {
    this.messageQueue.push(message);

    // Store in conversation history
    const convId = message.conversationId || 'default';
    if (!this.conversationHistory.has(convId)) {
      this.conversationHistory.set(convId, []);
    }
    this.conversationHistory.get(convId)!.push(message);

    // Handle message based on type
    switch (message.type) {
      case 'task_assignment':
        await this.handleTaskAssignment(message);
        break;
      case 'question':
        await this.handleQuestion(message);
        break;
      case 'collaboration_request':
        await this.handleCollaborationRequest(message);
        break;
    }
  }

  /**
   * Send message to another agent
   */
  protected async sendMessage(
    to: AgentRole | 'broadcast',
    type: MessageType,
    content: string,
    metadata?: Record<string, unknown>,
    conversationId?: string
  ): Promise<AgentMessage> {
    const message: AgentMessage = {
      id: randomUUID(),
      from: this.capability.role,
      to,
      type,
      content,
      metadata,
      timestamp: new Date(),
      conversationId,
    };

    // In a real system, this would send to message bus
    // For now, we'll emit events or use callbacks
    this.emit('message', message);

    return message;
  }

  /**
   * Query cognitive router
   */
  protected async query(
    prompt: string,
    taskType?: string,
    systemPrompt?: string
  ): Promise<string> {
    const response = await this.router.route({
      prompt,
      taskType: taskType as any,
      systemPrompt: systemPrompt || this.getDefaultSystemPrompt(),
      temperature: 0.7,
      maxTokens: 4000,
    });

    return response.content;
  }

  /**
   * Store knowledge in graph memory
   */
  protected storeKnowledge(
    type: 'file' | 'function' | 'decision' | 'task',
    name: string,
    content: string,
    metadata: Record<string, any> = {}
  ): string {
    // @ts-ignore
    return this.memory.storeNode({
      type,
      // @ts-ignore
      name,
      content,
      metadata: { ...metadata, agent: this.capability.role },
    });
  }

  /**
   * Retrieve relevant context from memory
   */
  protected async retrieveContext(query: string, limit = 5): Promise<string> {
    // @ts-ignore
    const nodes = this.memory.search(query, limit);
    return nodes
      .map(n => `[${n.type}] ${n.name}:\n${n.content.slice(0, 500)}`)
      .join('\n\n---\n\n');
  }

  protected abstract getDefaultSystemPrompt(): string;

  private async handleTaskAssignment(message: AgentMessage): Promise<void> {
    const task = message.metadata?.task as Task;
    if (!task) return;

    this.activeTasks.set(task.id, task);

    try {
      const result = await this.executeTask(task);
      
      await this.sendMessage(
        message.from,
        'task_result',
        JSON.stringify(result),
        { taskId: task.id, result },
        message.conversationId
      );

      this.activeTasks.delete(task.id);
    } catch (error) {
      await this.sendMessage(
        message.from,
        'error',
        (error as Error).message,
        { taskId: task.id },
        message.conversationId
      );
    }
  }

  private async handleQuestion(message: AgentMessage): Promise<void> {
    const answer = await this.query(message.content);
    
    await this.sendMessage(
      message.from,
      'answer',
      answer,
      { questionId: message.id },
      message.conversationId
    );
  }

  private async handleCollaborationRequest(message: AgentMessage): Promise<void> {
    // Subclasses can override
  }

  // Simple event emitter
  private listeners: Map<string, Array<(data: any) => void>> = new Map();

  protected emit(event: string, data: any): void {
    const handlers = this.listeners.get(event) || [];
    handlers.forEach(handler => handler(data));
  }

  on(event: string, handler: (data: any) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(handler);
  }

  getRole(): AgentRole {
    return this.capability.role;
  }

  getCapability(): AgentCapability {
    return this.capability;
  }
}
