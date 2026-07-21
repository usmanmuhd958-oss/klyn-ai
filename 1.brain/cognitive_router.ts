import { LLMGateway } from './llm_gateway.js';
import { CostOptimizer } from './cost_optimizer.js';

export class CognitiveRouter {
  private gateway: LLMGateway;
  private optimizer: CostOptimizer;

  constructor(gateway: LLMGateway, optimizer: CostOptimizer) {
    this.gateway = gateway;
    this.optimizer = optimizer;
  }

  public getGateway(): LLMGateway {
    return this.gateway;
  }

  public async route(task: any): Promise<any> {
    const prompt = typeof task === 'string' ? task : task.prompt || task.description || JSON.stringify(task);
    
    let decision = { provider: 'mock', model: 'mock-model' };
    if (this.optimizer && typeof (this.optimizer as any).optimize === 'function') {
      decision = (this.optimizer as any).optimize(prompt);
    } else if (this.optimizer && typeof (this.optimizer as any).optimizeRoute === 'function') {
      decision = (this.optimizer as any).optimizeRoute(prompt);
    }

    const response = await this.gateway.execute({
      prompt,
      provider: decision.provider,
      model: decision.model
    });

    return response.text || response;
  }

  public async routeTask(task: any): Promise<any> {
    return this.route(task);
  }

  public async execute(provider: string, task: any): Promise<any> {
    return this.gateway.execute(task, { provider });
  }

  public getCostMetrics(): any {
    return this.gateway.getCostMetrics();
  }
}

export default CognitiveRouter;
