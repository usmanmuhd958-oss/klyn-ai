// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
// 1.brain/agent_engine.ts
import { CognitiveRouter, type RouteDecision, type ContextWindow } from './cognitive_router.js';
import { RepoIngestionPipeline, type DAGNode, type IngestionStats } from '../kernel/src/pipeline/repo_ingest.js';
import { ASTDependencyGraph } from '../kernel/src/ast/dependency_graph.js';
import { PatchGenerator, type UnifiedDiff, type FileOperation } from './patch_generator.js';
import { PatchValidator, type ValidationResult } from './patch_validator.js';
import { writeFile, readFile, unlink, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface AgentQuery {
  query: string;
  repositoryPath: string;
  options?: AgentOptions;
}

export interface AgentOptions {
  dryRun?: boolean;
  autoApply?: boolean;
  validateImports?: boolean;
  maxRetries?: number;
}

export interface ExecutionResult {
  success: boolean;
  route: RouteDecision;
  patches: UnifiedDiff[];
  validation: ValidationResult;
  appliedFiles: string[];
  errors: string[];
  stats: ExecutionStats;
}

export interface ExecutionStats {
  ingestionTime: number;
  routingTime: number;
  generationTime: number;
  validationTime: number;
  applicationTime: number;
  totalTime: number;
  filesModified: number;
  filesCreated: number;
  filesDeleted: number;
}

export class AgentExecutionEngine {
  private pipeline: RepoIngestionPipeline;
  private router: CognitiveRouter | null = null;
  private depGraph: ASTDependencyGraph | null = null;
  private patchGenerator: PatchGenerator;
  private validator: PatchValidator | null = null;
  private dagRoot: DAGNode | null = null;
  private ingestionStats: IngestionStats | null = null;

  constructor() {
    this.pipeline = new RepoIngestionPipeline();
    this.patchGenerator = new PatchGenerator();
  }

  async execute(agentQuery: AgentQuery): Promise<ExecutionResult> {
    const startTime = performance.now();
    const stats: ExecutionStats = {
      ingestionTime: 0,
      routingTime: 0,
      generationTime: 0,
      validationTime: 0,
      applicationTime: 0,
      totalTime: 0,
      filesModified: 0,
      filesCreated: 0,
      filesDeleted: 0,
    };

    const options: Required<AgentOptions> = {
      dryRun: agentQuery.options?.dryRun ?? true,
      autoApply: agentQuery.options?.autoApply ?? false,
      validateImports: agentQuery.options?.validateImports ?? true,
      maxRetries: agentQuery.options?.maxRetries ?? 3,
    };

    try {
      const ingestStart = performance.now();
      await this.ingestRepository(agentQuery.repositoryPath);
      stats.ingestionTime = performance.now() - ingestStart;

      const routeStart = performance.now();
      const route = this.router!.route(agentQuery.query);
      stats.routingTime = performance.now() - routeStart;

      const genStart = performance.now();
      const patches = await this.generatePatches(route, agentQuery.query);
      stats.generationTime = performance.now() - genStart;

      const valStart = performance.now();
      const validation = await this.validatePatches(patches, options.dryRun);
      stats.validationTime = performance.now() - valStart;

      let appliedFiles: string[] = [];
      const errors: string[] = [];

      if (!validation.valid) {
        errors.push(...validation.errors.map(e => `${e.type}: ${e.message}`));
      }

      if (validation.valid && !options.dryRun && options.autoApply) {
        const appStart = performance.now();
        appliedFiles = await this.applyPatches(patches);
        stats.applicationTime = performance.now() - appStart;

        stats.filesModified = patches.filter(p =>
          p.operations.some(op => op.type === 'modify')
        ).length;
        stats.filesCreated = patches.filter(p =>
          p.operations.some(op => op.type === 'create')
        ).length;
        stats.filesDeleted = patches.filter(p =>
          p.operations.some(op => op.type === 'delete')
        ).length;
      }

      stats.totalTime = performance.now() - startTime;

      return {
        success: validation.valid && errors.length === 0,
        route,
        patches,
        validation,
        appliedFiles,
        errors,
        stats,
      };
    } catch (error) {
      stats.totalTime = performance.now() - startTime;

      return {
        success: false,
        route: this.createDefaultRoute(agentQuery.query),
        patches: [],
        validation: { valid: false, errors: [], warnings: [] },
        appliedFiles: [],
        errors: [error instanceof Error ? error.message : String(error)],
        stats,
      };
    }
  }

  async ingestRepository(repositoryPath: string): Promise<void> {
    const { dagRoot, stats } = await this.pipeline.ingestRepository(repositoryPath);

    this.dagRoot = dagRoot;
    this.ingestionStats = stats;

    this.depGraph = new ASTDependencyGraph();
    await this.depGraph.buildFromDAG(dagRoot);

    this.router = new CognitiveRouter(dagRoot, this.depGraph);
    this.validator = new PatchValidator(this.depGraph);
  }

  async generatePatches(route: RouteDecision, query: string): Promise<UnifiedDiff[]> {
    const patches: UnifiedDiff[] = [];

    switch (route.intent.type) {
      case 'modify':
        patches.push(...await this.generateModifyPatches(route));
        break;
      case 'create':
        patches.push(...await this.generateCreatePatches(route, query));
        break;
      case 'delete':
        patches.push(...await this.generateDeletePatches(route));
        break;
      case 'refactor':
        patches.push(...await this.generateRefactorPatches(route));
        break;
      default:
        break;
    }

    return patches;
  }

  async validatePatches(patches: UnifiedDiff[], dryRun: boolean): Promise<ValidationResult> {
    if (!this.validator) {
      return { valid: false, errors: [], warnings: [] };
    }

    return this.validator.validateBatch(patches);
  }

  async applyPatches(patches: UnifiedDiff[]): Promise<string[]> {
    const appliedFiles: string[] = [];

    for (const patch of patches) {
      for (const operation of patch.operations) {
        try {
          await this.applyOperation(operation);
          appliedFiles.push(operation.path);
        } catch (error) {
          console.error(`Failed to apply operation on ${operation.path}:`, error);
        }
      }
    }

    return appliedFiles;
  }

  getIngestionStats(): IngestionStats | null {
    return this.ingestionStats;
  }

  getDAGRoot(): DAGNode | null {
    return this.dagRoot;
  }

  getDependencyGraph(): ASTDependencyGraph | null {
    return this.depGraph;
  }

  private async generateModifyPatches(route: RouteDecision): Promise<UnifiedDiff[]> {
    const patches: UnifiedDiff[] = [];

    for (const file of route.context.relevantFiles) {
      const modifications = this.generateModifications(file.content, route);

      if (modifications !== file.content) {
        const diff = this.patchGenerator.generateUnifiedDiff(
          file.path,
          file.content,
          modifications
        );
        patches.push(diff);
      }
    }

    return patches;
  }

  private async generateCreatePatches(route: RouteDecision, query: string): Promise<UnifiedDiff[]> {
    const patches: UnifiedDiff[] = [];

    for (const targetFile of route.intent.targetFiles) {
      const content = this.generateFileContent(targetFile, route, query);

      const diff = this.patchGenerator.generateCreateDiff(targetFile, content);
      patches.push(diff);
    }

    return patches;
  }

  private async generateDeletePatches(route: RouteDecision): Promise<UnifiedDiff[]> {
    const patches: UnifiedDiff[] = [];

    for (const file of route.context.relevantFiles) {
      const diff = this.patchGenerator.generateDeleteDiff(file.path, file.content);
      patches.push(diff);
    }

    return patches;
  }

  private async generateRefactorPatches(route: RouteDecision): Promise<UnifiedDiff[]> {
    const patches: UnifiedDiff[] = [];

    for (const file of route.context.relevantFiles) {
      const refactored = this.applyRefactoring(file.content, route);

      if (refactored !== file.content) {
        const diff = this.patchGenerator.generateUnifiedDiff(
          file.path,
          file.content,
          refactored
        );
        patches.push(diff);
      }
    }

    return patches;
  }

  private generateModifications(content: string, route: RouteDecision): string {
    let modified = content;

    for (const symbol of route.intent.symbols) {
      const oldPattern = new RegExp(`\\b${symbol}\\b`, 'g');
      const newSymbol = `Updated${symbol}`;
      modified = modified.replace(oldPattern, newSymbol);
    }

    return modified;
  }

  private generateFileContent(filePath: string, route: RouteDecision, query: string): string {
    const ext = filePath.split('.').pop();
    
    if (ext === 'ts' || ext === 'tsx') {
      return this.generateTypeScriptFile(filePath, route, query);
    } else if (ext === 'js' || ext === 'jsx') {
      return this.generateJavaScriptFile(filePath, route, query);
    }

    return `// Generated file: ${filePath}\n// Query: ${query}\n`;
  }

  private generateTypeScriptFile(filePath: string, route: RouteDecision, query: string): string {
    const lines: string[] = [];
    const fileName = filePath.split('/').pop()?.replace('.ts', '') || 'Module';
    const className = fileName.charAt(0).toUpperCase() + fileName.slice(1);

    lines.push(`// Auto-generated by Klyn AI OS`);
    lines.push(`// Query: ${query}`);
    lines.push(``);

    const imports = this.inferRequiredImports(route);
    for (const imp of imports) {
      lines.push(imp);
    }

    if (imports.length > 0) {
      lines.push(``);
    }

    lines.push(`export class ${className} {`);
    lines.push(`  constructor() {}`);
    lines.push(``);

    for (const symbol of route.intent.symbols) {
      lines.push(`  ${symbol}(): void {`);
      lines.push(`    // TODO: Implement ${symbol}`);
      lines.push(`  }`);
      lines.push(``);
    }

    lines.push(`}`);
    lines.push(``);

    return lines.join('\n');
  }

  private generateJavaScriptFile(filePath: string, route: RouteDecision, query: string): string {
    const lines: string[] = [];

    lines.push(`// Auto-generated by Klyn AI OS`);
    lines.push(`// Query: ${query}`);
    lines.push(``);

    const imports = this.inferRequiredImports(route);
    for (const imp of imports) {
      lines.push(imp.replace('import', 'const').replace('from', '= require('));
    }

    if (imports.length > 0) {
      lines.push(``);
    }

    lines.push(`module.exports = {`);

    for (const symbol of route.intent.symbols) {
      lines.push(`  ${symbol}: () => {`);
      lines.push(`    // TODO: Implement ${symbol}`);
      lines.push(`  },`);
    }

    lines.push(`};`);
    lines.push(``);

    return lines.join('\n');
  }

  private applyRefactoring(content: string, route: RouteDecision): string {
    let refactored = content;

    refactored = this.removeUnusedImports(refactored);
    refactored = this.sortImports(refactored);
    refactored = this.formatCode(refactored);

    return refactored;
  }

  private removeUnusedImports(content: string): string {
    const lines = content.split('\n');
    const importLines = lines.filter(line => line.trim().startsWith('import'));
    const usedImports = new Set<string>();

    for (const line of lines) {
      const matches = line.match(/\b([A-Z][a-zA-Z0-9]+)\b/g);
      if (matches) {
        matches.forEach(m => usedImports.add(m));
      }
    }

    const filteredImports = importLines.filter(line => {
      const match = line.match(/import\s+(?:\{([^}]+)\}|(\w+))/);
      if (match) {
        const symbols = match[1] ? match[1].split(',').map(s => s.trim()) : [match[2]];
        return symbols.some(s => usedImports.has(s));
      }
      return false;
    });

    const nonImportLines = lines.filter(line => !line.trim().startsWith('import'));

    return [...filteredImports, '', ...nonImportLines].join('\n');
  }

  private sortImports(content: string): string {
    const lines = content.split('\n');
    const importLines = lines.filter(line => line.trim().startsWith('import')).sort();
    const nonImportLines = lines.filter(line => !line.trim().startsWith('import'));

    return [...importLines, '', ...nonImportLines].join('\n');
  }

  private formatCode(content: string): string {
    const lines = content.split('\n');
    const formatted: string[] = [];
    let indentLevel = 0;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.endsWith('}')) {
        indentLevel = Math.max(0, indentLevel - 1);
      }

      const indent = '  '.repeat(indentLevel);
      formatted.push(indent + trimmed);

      if (trimmed.endsWith('{')) {
        indentLevel++;
      }
    }

    return formatted.join('\n');
  }

  private inferRequiredImports(route: RouteDecision): string[] {
    const imports: string[] = [];
    const symbolSources = new Map<string, string>();

    for (const [filePath, symbols] of route.context.symbols.entries()) {
      for (const symbol of symbols) {
        symbolSources.set(symbol, filePath);
      }
    }

    for (const symbol of route.intent.symbols) {
      const source = symbolSources.get(symbol);
      if (source) {
        imports.push(`import { ${symbol} } from '${source}';`);
      }
    }

    return imports;
  }

  private async applyOperation(operation: FileOperation): Promise<void> {
    switch (operation.type) {
      case 'create':
        await this.createFile(operation.path, operation.content);
        break;
      case 'modify':
        await this.modifyFile(operation.path, operation.newContent);
        break;
      case 'delete':
        await this.deleteFile(operation.path);
        break;
    }
  }

  private async createFile(filePath: string, content: string): Promise<void> {
    const dir = dirname(filePath);
    await mkdir(dir, { recursive: true });
    await writeFile(filePath, content, 'utf-8');
  }

  private async modifyFile(filePath: string, content: string): Promise<void> {
    await writeFile(filePath, content, 'utf-8');
  }

  private async deleteFile(filePath: string): Promise<void> {
    await unlink(filePath);
  }

  private createDefaultRoute(query: string): RouteDecision {
    return {
      intent: {
        type: 'read',
        confidence: 0,
        targetFiles: [],
        symbols: [],
        operation: query,
      },
      context: {
        relevantFiles: [],
        dependencies: new Map(),
        symbols: new Map(),
        totalTokens: 0,
      },
      strategy: 'direct',
      estimatedComplexity: 0,
    };
  }
}
