import * as ts from "typescript";
import { IntelligenceLogger } from "./logger.js";
import { ASTValidationResult, CompilerError, SemanticIssue } from "./types.js";
import { existsSync, readFileSync } from "node:fs";
import * as fs from "node:fs";

export class TypeScriptASTValidator {
  private logger: IntelligenceLogger;
  private compilerOptions: ts.CompilerOptions;

  constructor() {
    this.logger = new IntelligenceLogger('TypeScriptASTValidator');
    this.compilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      noEmit: true,
    };
  }

  public async validateCode(
    code: string,
    fileName: string = 'temp.ts'
  ): Promise<ASTValidationResult> {
    try {
      this.logger.debug('Validating TypeScript code', { fileName });

      const sourceFile = ts.createSourceFile(
        fileName,
        code,
        ts.ScriptTarget.ES2022,
        true,
        ts.ScriptKind.TS
      );

      // Syntactic validation
      const syntacticDiagnostics = this.getSyntacticDiagnostics(sourceFile);

      // Semantic validation
      const program = this.createProgram([{ fileName, content: code }]);
      const semanticDiagnostics = this.getSemanticDiagnostics(program, fileName);
      const semanticIssues = this.extractSemanticIssues(semanticDiagnostics);

      const allDiagnostics = [...syntacticDiagnostics, ...semanticDiagnostics];
      const errors = allDiagnostics.filter(d => d.category === ts.DiagnosticCategory.Error);
      const warnings = allDiagnostics.filter(d => d.category === ts.DiagnosticCategory.Warning);

      const result: ASTValidationResult = {
        isValid: errors.length === 0,
        errors,
        warnings,
        syntaxTree: sourceFile,
        semanticIssues,
      };

      this.logger.info('Code validation completed', {
        isValid: result.isValid,
        errorCount: errors.length,
        warningCount: warnings.length,
      });

      return result;
    } catch (error) {
      this.logger.error('Code validation failed', { error });
      return {
        isValid: false,
        errors: [],
        warnings: [],
        syntaxTree: null,
        semanticIssues: [],
      };
    }
  }

  private getSyntacticDiagnostics(sourceFile: ts.SourceFile): ts.Diagnostic[] {
    const diagnostics: ts.Diagnostic[] = [];
    
    function visit(node: ts.Node) {
      // Check for syntax errors
      const nodeDiagnostics = (node as any).parseDiagnostics;
      if (nodeDiagnostics) {
        diagnostics.push(...nodeDiagnostics);
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return diagnostics;
  }

  private createProgram(files: Array<{ fileName: string; content: string }>): ts.Program {
    const fileMap = new Map(files.map(f => [f.fileName, f.content]));

    const host: ts.CompilerHost = {
      getSourceFile: (fileName: string) => {
        const content = fileMap.get(fileName);
        if (content !== undefined) {
          return ts.createSourceFile(fileName, content, ts.ScriptTarget.ES2022, true);
        }
        // Try to read from file system
        if (existsSync(fileName)) {
          const fileContent = fs.readFileSync(fileName, 'utf-8');
          return ts.createSourceFile(fileName, fileContent, ts.ScriptTarget.ES2022, true);
        }
        return undefined;
      },
      getDefaultLibFileName: () => ts.getDefaultLibFilePath(this.compilerOptions),
      writeFile: () => {},
      getCurrentDirectory: () => process.cwd(),
      getCanonicalFileName: (fileName: string) => fileName,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => '\n',
      fileExists: (fileName: string) => fileMap.has(fileName) || existsSync(fileName),
      readFile: (fileName: string) => fileMap.get(fileName) || '',
    };

    return ts.createProgram(
      Array.from(fileMap.keys()),
      this.compilerOptions,
      host
    );
  }

  private getSemanticDiagnostics(program: ts.Program, fileName: string): ts.Diagnostic[] {
    const sourceFile = program.getSourceFile(fileName);
    if (!sourceFile) return [];

    const diagnostics = [
      ...program.getSemanticDiagnostics(sourceFile),
      ...program.getDeclarationDiagnostics(sourceFile),
    ];

    return diagnostics;
  }

  private extractSemanticIssues(diagnostics: ts.Diagnostic[]): SemanticIssue[] {
    return diagnostics.map(diagnostic => {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
      const file = diagnostic.file?.fileName || 'unknown';
      const position = diagnostic.file && diagnostic.start !== undefined
        ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
        : { line: 0, character: 0 };

      let type: SemanticIssue['type'] = 'type-error';
      if (message.includes('unused')) type = 'unused-variable';
      if (message.includes('import')) type = 'missing-import';
      if (message.includes('circular')) type = 'circular-dependency';

      return {
        type,
        message,
        file,
        line: position.line + 1,
        column: position.character + 1,
        severity: diagnostic.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
        suggestedFix: this.generateSuggestedFix(diagnostic),
      };
    });
  }

  private generateSuggestedFix(diagnostic: ts.Diagnostic): string | undefined {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    
    // Simple heuristic-based suggestions
    if (message.includes("Cannot find name")) {
      const match = message.match(/Cannot find name '(.+)'/);
      if (match) {
        return `Consider importing or declaring '${match[1]}'`;
      }
    }
    
    if (message.includes("not assignable to type")) {
      return "Check type compatibility or use type assertion";
    }

    return undefined;
  }

  public extractCompilerErrors(diagnostics: ts.Diagnostic[]): CompilerError[] {
    return diagnostics
      .filter(d => d.category === ts.DiagnosticCategory.Error)
      .map(diagnostic => {
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
        const file = diagnostic.file?.fileName || 'unknown';
        const position = diagnostic.file && diagnostic.start !== undefined
          ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
          : { line: 0, character: 0 };

        const source = diagnostic.file && diagnostic.start !== undefined && diagnostic.length
          ? diagnostic.file.text.substring(diagnostic.start, diagnostic.start + diagnostic.length)
          : '';

        return {
          file,
          line: position.line + 1,
          column: position.character + 1,
          message,
          code: typeof diagnostic.code === 'number' ? diagnostic.code : 0,
          category: diagnostic.category,
          source,
          relatedInformation: diagnostic.relatedInformation,
        };
      });
  }
}
