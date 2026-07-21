import { parse } from '@babel/parser';

export class ASTIndexer {
  public parse(code: string): any {
    if (!code || typeof code !== 'string') {
      return { type: 'File', program: { body: [] } };
    }
    try {
      return parse(code, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx']
      });
    } catch (e) {
      return { type: 'File', program: { body: [] } };
    }
  }

  public index(code: string): any {
    return this.parse(code);
  }
}

export default ASTIndexer;
