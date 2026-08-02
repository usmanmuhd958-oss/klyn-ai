import { ASTParser } from '../src/parser/ast_parser.js';
import { LanguageDetector } from '../src/parser/language_detector.js';

export class ASTIndexer {
  [key: string]: any;
  
  public parse(code: string, filePath: string = 'unknown.ts'): any {
    if (!code || typeof code !== 'string') {
      return { type: 'File', program: { body: [] } };
    }
    try {
      const language = LanguageDetector.detect(filePath) || 'typescript';
      const nodes = ASTParser.parse(code, language, filePath);
      
      // Map to a format expected by consumers without allocating massive AST objects
      return {
        type: 'File',
        program: {
          body: nodes.map(n => ({
            type: n.type,
            name: n.name,
            dependencies: n.dependencies,
            exports: n.exports
          }))
        }
      };
    } catch (e) {
      return { type: 'File', program: { body: [] } };
    }
  }

  public index(code: string, filePath?: string): any {
    return this.parse(code, filePath);
  }
}

export default ASTIndexer;
