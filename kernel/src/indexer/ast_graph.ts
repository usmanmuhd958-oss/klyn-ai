// kernel/src/indexer/ast_graph.ts

import { readFile } from 'node:fs/promises';
import * as ts from 'typescript';
import { EventEmitter } from 'node:events';

/**
 * AST Dependency & Symbol Graph Extractor
 * Zero-dependency TypeScript/JavaScript parser
 * @version 1.0.0
 */

// ============================================================================
// Type Definitions
// ============================================================================

export interface SymbolInfo {
  name: string;
  kind: SymbolKind;
  filePath: string;
  line: number;
  column: number;
  exported: boolean;
  documentation?: string;
  signature?: string;
}

export enum SymbolKind {
  FUNCTION = 'function',
  CLASS = 'class',
  INTERFACE = 'interface',
  TYPE = 'type',
  VARIABLE = 'variable',
  CONST = 'const',
  ENUM = 'enum',
  NAMESPACE = 'namespace',
  METHOD = 'method',
  PROPERTY = 'property',
}

export interface ImportInfo {
  importedFrom: string;
  symbols: string[];
  isDefault: boolean;
  isNamespace: boolean;
  line: number;
}

export interface FileMetadata {
  path: string;
  symbols: SymbolInfo[];
  imports: ImportInfo[];
  exports: string[];
  dependencies: Set<string>;
  dependents: Set<string>;
  lastParsed: number;
}

export interface DependencyGraph {
  nodes: Map<string, FileMetadata>;
  edges: Map<string, Set<string>>; // file -> dependencies
  reverseEdges: Map<string, Set<string>>; // file -> dependents
}

export interface CallGraphEdge {
  from: { file: string; symbol: string };
  to: { file: string; symbol: string };
  type: 'calls' | 'extends' | 'implements' | 'uses';
}

export interface ASTGraphConfig {
  includedExtensions: string[];
  parseJSDoc: boolean;
  followDynamicImports: boolean;
  maxFileSize: number;
}

// ============================================================================
// Symbol Extractor
// ============================================================================

class SymbolExtractor {
  private sourceFile: ts.SourceFile;
  private filePath: string;
  private symbols: SymbolInfo[] = [];

  constructor(sourceFile: ts.SourceFile, filePath: string) {
    this.sourceFile = sourceFile;
    this.filePath = filePath;
  }

  public extract(): SymbolInfo[] {
    this.visit(this.sourceFile);
    return this.symbols;
  }

  private visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node)) {
      this.extractFunction(node);
    } else if (ts.isClassDeclaration(node)) {
      this.extractClass(node);
    } else if (ts.isInterfaceDeclaration(node)) {
      this.extractInterface(node);
    } else if (ts.isTypeAliasDeclaration(node)) {
      this.extractTypeAlias(node);
    } else if (ts.isVariableStatement(node)) {
      this.extractVariables(node);
    } else if (ts.isEnumDeclaration(node)) {
      this.extractEnum(node);
    } else if (ts.isModuleDeclaration(node)) {
      this.extractNamespace(node);
    }

    ts.forEachChild(node, child => this.visit(child));
  }

  private extractFunction(node: ts.FunctionDeclaration): void {
    if (!node.name) return;

    const pos = this.sourceFile.getLineAndCharacterOfPosition(node.getStart());
    const exported = this.hasExportModifier(node);

    this.symbols.push({
      name: node.name.text,
      kind: SymbolKind.FUNCTION,
      filePath: this.filePath,
      line: pos.line + 1,
      column: pos.character + 1,
      exported,
      signature: this.getFunctionSignature(node),
      documentation: this.getDocumentation(node),
    });
  }

  private extractClass(node: ts.ClassDeclaration): void {
    if (!node.name) return;

    const pos = this.sourceFile.getLineAndCharacterOfPosition(node.getStart());
    const exported = this.hasExportModifier(node);

    this.symbols.push({
      name: node.name.text,
      kind: SymbolKind.CLASS,
      filePath: this.filePath,
      line: pos.line + 1,
      column: pos.character + 1,
      exported,
      documentation: this.getDocumentation(node),
    });

    // Extract methods
    for (const member of node.members) {
      if (ts.isMethodDeclaration(member) && member.name) {
        const methodPos = this.sourceFile.getLineAndCharacterOfPosition(
          member.getStart()
        );

        this.symbols.push({
          name: `${node.name.text}.${this.getMemberName(member.name)}`,
          kind: SymbolKind.METHOD,
          filePath: this.filePath,
          line: methodPos.line + 1,
          column: methodPos.character + 1,
          exported: false,
          signature: this.getMethodSignature(member),
          documentation: this.getDocumentation(member),
        });
      }
    }
  }

  private extractInterface(node: ts.InterfaceDeclaration): void {
    const pos = this.sourceFile.getLineAndCharacterOfPosition(node.getStart());
    const exported = this.hasExportModifier(node);

    this.symbols.push({
      name: node.name.text,
      kind: SymbolKind.INTERFACE,
      filePath: this.filePath,
      line: pos.line + 1,
      column: pos.character + 1,
      exported,
      documentation: this.getDocumentation(node),
    });
  }

  private extractTypeAlias(node: ts.TypeAliasDeclaration): void {
    const pos = this.sourceFile.getLineAndCharacterOfPosition(node.getStart());
    const exported = this.hasExportModifier(node);

    this.symbols.push({
      name: node.name.text,
      kind: SymbolKind.TYPE,
      filePath: this.filePath,
      line: pos.line + 1,
      column: pos.character + 1,
      exported,
      documentation: this.getDocumentation(node),
    });
  }

  private extractVariables(node: ts.VariableStatement): void {
    const exported = this.hasExportModifier(node);

    for (const declaration of node.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) {
        const pos = this.sourceFile.getLineAndCharacterOfPosition(
          declaration.getStart()
        );

        const kind =
          node.declarationList.flags & ts.NodeFlags.Const
            ? SymbolKind.CONST
            : SymbolKind.VARIABLE;

        this.symbols.push({
          name: declaration.name.text,
          kind,
          filePath: this.filePath,
          line: pos.line + 1,
          column: pos.character + 1,
          exported,
          documentation: this.getDocumentation(node),
        });
      }
    }
  }

  private extractEnum(node: ts.EnumDeclaration): void {
    const pos = this.sourceFile.getLineAndCharacterOfPosition(node.getStart());
    const exported = this.hasExportModifier(node);

    this.symbols.push({
      name: node.name.text,
      kind: SymbolKind.ENUM,
      filePath: this.filePath,
      line: pos.line + 1,
      column: pos.character + 1,
      exported,
      documentation: this.getDocumentation(node),
    });
  }

  private extractNamespace(node: ts.ModuleDeclaration): void {
    if (!ts.isIdentifier(node.name)) return;

    const pos = this.sourceFile.getLineAndCharacterOfPosition(node.getStart());
    const exported = this.hasExportModifier(node);

    this.symbols.push({
      name: node.name.text,
      kind: SymbolKind.NAMESPACE,
      filePath: this.filePath,
      line: pos.line + 1,
      column: pos.character + 1,
      exported,
      documentation: this.getDocumentation(node),
    });
  }

  private hasExportModifier(node: ts.Node): boolean {
    if (!(node as any).modifiers) return false;

    return (node as any).modifiers.some(
      modifier => modifier.kind === ts.SyntaxKind.ExportKeyword
    );
  }

  private getDocumentation(node: ts.Node): string | undefined {
    const jsDoc = (node as any).jsDoc;
    if (jsDoc && jsDoc.length > 0) {
      return jsDoc[0].comment || undefined;
    }
    return undefined;
  }

  private getFunctionSignature(node: ts.FunctionDeclaration): string {
    const params = node.parameters
      .map(p => `${p.name.getText()}: ${p.type?.getText() || 'any'}`)
      .join(', ');

    const returnType = node.type?.getText() || 'void';

    return `(${params}) => ${returnType}`;
  }

  private getMethodSignature(node: ts.MethodDeclaration): string {
    const params = node.parameters
      .map(p => `${p.name.getText()}: ${p.type?.getText() || 'any'}`)
      .join(', ');

    const returnType = node.type?.getText() || 'void';

    return `(${params}) => ${returnType}`;
  }

  private getMemberName(name: ts.PropertyName): string {
    if (ts.isIdentifier(name)) {
      return name.text;
    } else if (ts.isStringLiteral(name)) {
      return name.text;
    }
    return 'unknown';
  }
}

// ============================================================================
// Import Extractor
// ============================================================================

class ImportExtractor {
  private sourceFile: ts.SourceFile;
  private imports: ImportInfo[] = [];

  constructor(sourceFile: ts.SourceFile) {
    this.sourceFile = sourceFile;
  }

  public extract(): ImportInfo[] {
    this.visit(this.sourceFile);
    return this.imports;
  }

  private visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node)) {
      this.extractImport(node);
    }

    ts.forEachChild(node, child => this.visit(child));
  }

  private extractImport(node: ts.ImportDeclaration): void {
    if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) {
      return;
    }

    const importPath = node.moduleSpecifier.text;
    const pos = this.sourceFile.getLineAndCharacterOfPosition(node.getStart());

    if (!node.importClause) {
      // Side-effect import: import './module'
      this.imports.push({
        importedFrom: importPath,
        symbols: [],
        isDefault: false,
        isNamespace: false,
        line: pos.line + 1,
      });
      return;
    }

    const symbols: string[] = [];
    let isDefault = false;
    let isNamespace = false;

    // Default import: import X from './module'
    if (node.importClause.name) {
      symbols.push(node.importClause.name.text);
      isDefault = true;
    }

    // Named imports: import { X, Y } from './module'
    if (node.importClause.namedBindings) {
      if (ts.isNamedImports(node.importClause.namedBindings)) {
        for (const element of node.importClause.namedBindings.elements) {
          symbols.push(element.name.text);
        }
      } else if (ts.isNamespaceImport(node.importClause.namedBindings)) {
        // Namespace import: import * as X from './module'
        symbols.push(node.importClause.namedBindings.name.text);
        isNamespace = true;
      }
    }

    this.imports.push({
      importedFrom: importPath,
      symbols,
      isDefault,
      isNamespace,
      line: pos.line + 1,
    });
  }
}

// ============================================================================
// AST Graph Implementation
// ============================================================================

export class ASTGraph extends EventEmitter {
  private config: ASTGraphConfig;
  private graph: DependencyGraph;
  private symbolIndex: Map<string, SymbolInfo[]> = new Map(); // symbolName -> locations

  constructor(config?: Partial<ASTGraphConfig>) {
    super();

    this.config = {
      includedExtensions: config?.includedExtensions ?? [
        '.ts',
        '.tsx',
        '.js',
        '.jsx',
      ],
      parseJSDoc: config?.parseJSDoc ?? true,
      followDynamicImports: config?.followDynamicImports ?? false,
      maxFileSize: config?.maxFileSize ?? 1024 * 1024, // 1MB
    };

    this.graph = {
      nodes: new Map(),
      edges: new Map(),
      reverseEdges: new Map(),
    };
  }

  // ============================================================================
  // Parsing
  // ============================================================================

  public async parseFile(filePath: string): Promise<FileMetadata> {
    const startTime = performance.now();

    try {
      const content = await readFile(filePath, 'utf-8');

      if (content.length > this.config.maxFileSize) {
        throw new Error(`File too large: ${filePath}`);
      }

      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true
      );

      // Extract symbols
      const symbolExtractor = new SymbolExtractor(sourceFile, filePath);
      const symbols = symbolExtractor.extract();

      // Extract imports
      const importExtractor = new ImportExtractor(sourceFile);
      const imports = importExtractor.extract();

      // Build metadata
      const metadata: FileMetadata = {
        path: filePath,
        symbols,
        imports,
        exports: symbols.filter(s => s.exported).map(s => s.name),
        dependencies: new Set(imports.map(i => i.importedFrom)),
        dependents: new Set(),
        lastParsed: Date.now(),
      };

      // Update graph
      this.updateGraph(metadata);

      // Index symbols
      this.indexSymbols(symbols);

      const parseTime = performance.now() - startTime;
      this.emit('parse:complete', filePath, parseTime);

      return metadata;
    } catch (error) {
      this.emit('parse:error', filePath, error);
      throw error;
    }
  }

  private updateGraph(metadata: FileMetadata): void {
    const { path, dependencies } = metadata;

    // Add/update node
    this.graph.nodes.set(path, metadata);

    // Update edges
    this.graph.edges.set(path, new Set(dependencies));

    // Update reverse edges (dependents)
    for (const dep of dependencies) {
      if (!this.graph.reverseEdges.has(dep)) {
        this.graph.reverseEdges.set(dep, new Set());
      }
      this.graph.reverseEdges.get(dep)!.add(path);

      // Update dependent's metadata
      const depMetadata = this.graph.nodes.get(dep);
      if (depMetadata) {
        depMetadata.dependents.add(path);
      }
    }
  }

  private indexSymbols(symbols: SymbolInfo[]): void {
    for (const symbol of symbols) {
      if (!this.symbolIndex.has(symbol.name)) {
        this.symbolIndex.set(symbol.name, []);
      }
      this.symbolIndex.get(symbol.name)!.push(symbol);
    }
  }

  // ============================================================================
  // Query Interface
  // ============================================================================

  public getFileMetadata(filePath: string): FileMetadata | undefined {
    return this.graph.nodes.get(filePath);
  }

  public getDependencies(filePath: string, depth: number = 1): Set<string> {
    const result = new Set<string>();
    const visited = new Set<string>();
    const queue: Array<{ path: string; level: number }> = [
      { path: filePath, level: 0 },
    ];

    while (queue.length > 0) {
      const { path, level } = queue.shift()!;

      if (visited.has(path) || level > depth) {
        continue;
      }

      visited.add(path);

      const deps = this.graph.edges.get(path);
      if (deps) {
        for (const dep of deps) {
          result.add(dep);
          if (level < depth) {
            queue.push({ path: dep, level: level + 1 });
          }
        }
      }
    }

    return result;
  }

  public getDependents(filePath: string, depth: number = 1): Set<string> {
    const result = new Set<string>();
    const visited = new Set<string>();
    const queue: Array<{ path: string; level: number }> = [
      { path: filePath, level: 0 },
    ];

    while (queue.length > 0) {
      const { path, level } = queue.shift()!;

      if (visited.has(path) || level > depth) {
        continue;
      }

      visited.add(path);

      const dependents = this.graph.reverseEdges.get(path);
      if (dependents) {
        for (const dependent of dependents) {
          result.add(dependent);
          if (level < depth) {
            queue.push({ path: dependent, level: level + 1 });
          }
        }
      }
    }

    return result;
  }

  public findSymbol(symbolName: string): SymbolInfo[] {
    return this.symbolIndex.get(symbolName) ?? [];
  }

  public findSymbolsInFile(filePath: string): SymbolInfo[] {
    const metadata = this.graph.nodes.get(filePath);
    return metadata?.symbols ?? [];
  }

  public findExportedSymbols(filePath: string): SymbolInfo[] {
    const metadata = this.graph.nodes.get(filePath);
    return metadata?.symbols.filter(s => s.exported) ?? [];
  }

  public getImportChain(
    fromFile: string,
    toFile: string
  ): string[] | null {
    const visited = new Set<string>();
    const queue: Array<{ path: string; chain: string[] }> = [
      { path: fromFile, chain: [fromFile] },
    ];

    while (queue.length > 0) {
      const { path, chain } = queue.shift()!;

      if (path === toFile) {
        return chain;
      }

      if (visited.has(path)) {
        continue;
      }

      visited.add(path);

      const deps = this.graph.edges.get(path);
      if (deps) {
        for (const dep of deps) {
          queue.push({ path: dep, chain: [...chain, dep] });
        }
      }
    }

    return null;
  }

  public getAllFiles(): string[] {
    return Array.from(this.graph.nodes.keys());
  }

  public getStats(): {
    totalFiles: number;
    totalSymbols: number;
    totalDependencies: number;
  } {
    let totalDeps = 0;
    for (const deps of this.graph.edges.values()) {
      totalDeps += deps.size;
    }

    return {
      totalFiles: this.graph.nodes.size,
      totalSymbols: this.symbolIndex.size,
      totalDependencies: totalDeps,
    };
  }

  public clear(): void {
    this.graph.nodes.clear();
    this.graph.edges.clear();
    this.graph.reverseEdges.clear();
    this.symbolIndex.clear();
  }
}

export default ASTGraph;
