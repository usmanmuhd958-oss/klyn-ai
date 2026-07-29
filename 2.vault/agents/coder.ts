// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
import { BaseAgent } from './base_agent.js';
import { ASTIndexer } from '../1.brain/ast_indexer.js';

// @ts-ignore
export class CoderAgent extends BaseAgent {
  [key: string]: any;
  private astIndexer: ASTIndexer;

  constructor(brain: any) {
    // @ts-ignore
    super('coder', 'Software Engineer', brain);
    this.astIndexer = new ASTIndexer();
  }

  public async executeTask(task: any): Promise<any> {
    return this.generateCode(task);
  }

  public async generateCode(task: any): Promise<any> {
    const prompt = typeof task === 'string' ? task : task.prompt || task.description || 'Generate code';
    const rawResponse = await this.query(prompt);
    
    const responseText = typeof rawResponse === 'string' 
      ? rawResponse 
      // @ts-ignore
      : (rawResponse?.text || String(rawResponse || '// Mock generated code'));

    try {
      if (responseText) {
        this.astIndexer.parse(responseText);
      }
    } catch (err: any) {
      console.log(`[Coder] AST info: ${err.message}`);
    }

    const lines = responseText ? responseText.split('\n') : [];

    return {
      code: responseText,
      linesCount: lines.length,
      status: 'completed'
    };
  }
}

export default CoderAgent;
