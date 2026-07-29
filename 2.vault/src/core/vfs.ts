// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
/**
 * @fileoverview Klyn AI OS - Virtual File System & AI Context Graph
 * @module core/vfs
 * @author Klyn Systems Architecture Team
 * @license Proprietary
 * 
 * Enterprise-grade in-memory virtual filesystem with AST-aware context indexing,
 * streaming watchers, differential sync, and intelligent memory management.
 */

import { EventEmitter } from 'events';
import { 
  readFile, 
  writeFile, 
  mkdir, 
  readdir, 
  stat, 
  unlink, 
  rmdir,
  watch as fsWatch,
} from 'fs/promises';
import { Stats, FSWatcher } from 'fs';
import { join, resolve, dirname, basename, extname, relative, isAbsolute, sep } from 'path';
import { createHash } from 'crypto';
import { performance } from 'perf_hooks';
import * as ts from 'typescript';

// ============================================================================
// ERROR HIERARCHY
// ============================================================================

class VFSError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly path?: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'VFSError';
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      path: this.path,
      context: this.context,
    };
  }
}

class PathTraversalError extends VFSError {
  constructor(path: string) {
    super(
      `Path traversal attack detected: ${path}`,
      'PATH_TRAVERSAL',
      path
    );
    this.name = 'PathTraversalError';
  }
}

class FileNotFoundError extends VFSError {
  constructor(path: string) {
    super(
      `File not found: ${path}`,
      'FILE_NOT_FOUND',
      path
    );
    this.name = 'FileNotFoundError';
  }
}

class DirectoryNotFoundError extends VFSError {
  constructor(path: string) {
    super(
      `Directory not found: ${path}`,
      'DIRECTORY_NOT_FOUND',
      path
    );
    this.name = 'DirectoryNotFoundError';
  }
}

class FileExistsError extends VFSError {
  constructor(path: string) {
    super(
      `File already exists: ${path}`,
      'FILE_EXISTS',
      path
    );
    this.name = 'FileExistsError';
  }
}

class InvalidPathError extends VFSError {
  constructor(path: string, reason: string) {
    super(
      `Invalid path: ${path} - ${reason}`,
      'INVALID_PATH',
      path,
      { reason }
    );
    this.name = 'InvalidPathError';
  }
}

class ASTParseError extends VFSError {
  constructor(path: string, parseError: string) {
    super(
      `Failed to parse AST: ${path}`,
      'AST_PARSE_ERROR',
      path,
      { parseError }
    );
    this.name = 'ASTParseError';
  }
}

class MemoryLimitError extends VFSError {
  constructor(limit: number, current: number) {
    super(
      `Memory limit exceeded: ${current}/${limit} bytes`,
      'MEMORY_LIMIT_EXCEEDED',
      undefined,
      { limit, current }
    );
    this.name = 'MemoryLimitError';
  }
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

type NodeType = 'file' | 'directory';

interface VFSNodeMetadata {
  readonly created: number;
  readonly modified: number;
  readonly accessed: number;
  readonly size: number;
  readonly hash: string;
}

interface VFSNode {
  readonly path: string;
  readonly name: string;
  readonly type: NodeType;
  metadata: VFSNodeMetadata;
  parent: VFSDirectoryNode | null;
}

interface VFSFileNode extends VFSNode {
  readonly type: 'file';
  content: Buffer;
  encoding: BufferEncoding;
  dirty: boolean;
  ast: ASTContext | null;
}

interface VFSDirectoryNode extends VFSNode {
  readonly type: 'directory';
  children: Map<string, VFSNode>;
}

interface ImportDeclaration {
  readonly source: string;
  readonly specifiers: ReadonlyArray<string>;
  readonly isTypeOnly: boolean;
  readonly line: number;
}

interface ExportDeclaration {
  readonly name: string;
  readonly kind: 'function' | 'class' | 'interface' | 'type' | 'const' | 'let' | 'var' | 'enum';
  readonly isDefault: boolean;
  readonly line: number;
}

interface TypeDefinition {
  readonly name: string;
  readonly kind: 'interface' | 'type' | 'class' | 'enum';
  readonly line: number;
  readonly documentation?: string;
}

interface ASTContext {
  readonly filePath: string;
  readonly imports: ReadonlyArray<ImportDeclaration>;
  readonly exports: ReadonlyArray<ExportDeclaration>;
  readonly types: ReadonlyArray<TypeDefinition>;
  readonly dependencies: ReadonlyArray<string>;
  readonly tokens: number;
  readonly parseTime: number;
  readonly hash: string;
}

interface DependencyNode {
  readonly path: string;
  readonly imports: Set<string>;
  readonly importedBy: Set<string>;
  readonly exports: ReadonlyArray<string>;
  readonly depth: number;
}

interface DependencyGraph {
  readonly nodes: Map<string, DependencyNode>;
  readonly roots: ReadonlyArray<string>;
  readonly leaves: ReadonlyArray<string>;
}

interface FileDiff {
  readonly path: string;
  readonly type: 'created' | 'modified' | 'deleted';
  readonly timestamp: number;
  readonly oldHash?: string;
  readonly newHash?: string;
  readonly sizeChange?: number;
}

interface VFSEventMap {
  'file:created': { path: string; node: VFSFileNode };
  'file:modified': { path: string; node: VFSFileNode; diff: FileDiff };
  'file:deleted': { path: string; metadata: VFSNodeMetadata };
  'file:accessed': { path: string; node: VFSFileNode };
  'directory:created': { path: string; node: VFSDirectoryNode };
  'directory:deleted': { path: string; metadata: VFSNodeMetadata };
  'ast:updated': { path: string; ast: ASTContext };
  'ast:error': { path: string; error: ASTParseError };
  'sync:start': { path: string };
  'sync:complete': { path: string; duration: number };
  'sync:error': { path: string; error: Error };
  'cache:evicted': { path: string; size: number };
  'memory:warning': { usage: number; limit: number };
  'error': VFSError;
  [key: string]: unknown;
}

interface VFSStats {
  readonly totalFiles: number;
  readonly totalDirectories: number;
  readonly totalSize: number;
  readonly memoryUsage: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly dirtyFiles: number;
  readonly astIndexed: number;
}

interface AIContextQuery {
  readonly entryPoint: string;
  readonly maxDepth?: number;
  readonly maxTokens?: number;
  readonly includeTypes?: boolean;
  readonly includeTests?: boolean;
}

interface AIContext {
  readonly files: ReadonlyArray<string>;
  readonly content: Map<string, string>;
  readonly dependencies: DependencyGraph;
  readonly totalTokens: number;
  readonly truncated: boolean;
}

// ============================================================================
// TYPED EVENT EMITTER
// ============================================================================

class TypedEventEmitter<TEventMap extends Record<string, unknown>> {
  private readonly emitter: EventEmitter;

  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(1000);
  }

  on<K extends keyof TEventMap>(event: K, handler: (payload: TEventMap[K]) => void): this {
    this.emitter.on(event as string, handler);
    return this;
  }

  once<K extends keyof TEventMap>(event: K, handler: (payload: TEventMap[K]) => void): this {
    this.emitter.once(event as string, handler);
    return this;
  }

  emit<K extends keyof TEventMap>(event: K, payload: TEventMap[K]): boolean {
    return this.emitter.emit(event as string, payload);
  }

  off<K extends keyof TEventMap>(event: K, handler: (payload: TEventMap[K]) => void): this {
    this.emitter.off(event as string, handler);
    return this;
  }

  removeAllListeners(event?: keyof TEventMap): this {
    this.emitter.removeAllListeners(event as string);
    return this;
  }
}

// ============================================================================
// PATH VALIDATOR & SANITIZER
// ============================================================================

class PathValidator {
  private static readonly FORBIDDEN_PATTERNS = [
    /\.\./,
    /^\/etc\//,
    /^\/proc\//,
    /^\/sys\//,
    /^\/dev\//,
    /^[A-Z]:\\/i,
    /\0/,
    /[<>:"|?*]/,
  ];

  private static readonly MAX_PATH_LENGTH = 4096;
  private static readonly MAX_COMPONENT_LENGTH = 255;

  static validate(path: string, rootPath: string): string {
    if (!path || typeof path !== 'string') {
      throw new InvalidPathError(path, 'Path must be a non-empty string');
    }

    if (path.length > this.MAX_PATH_LENGTH) {
      throw new InvalidPathError(path, `Path exceeds maximum length of ${this.MAX_PATH_LENGTH}`);
    }

    for (const pattern of this.FORBIDDEN_PATTERNS) {
      if (pattern.test(path)) {
        throw new PathTraversalError(path);
      }
    }

    const normalized = resolve(rootPath, path);
    const relativePath = relative(rootPath, normalized);
    
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
      throw new PathTraversalError(path);
    }

    const components = normalized.split(sep);
    for (const component of components) {
      if (component.length > this.MAX_COMPONENT_LENGTH) {
        throw new InvalidPathError(
          path,
          `Path component exceeds maximum length of ${this.MAX_COMPONENT_LENGTH}`
        );
      }
    }

    return normalized;
  }

  static toVFSPath(absolutePath: string, rootPath: string): string {
    return '/' + relative(rootPath, absolutePath).split(sep).join('/');
  }

  static toAbsolutePath(vfsPath: string, rootPath: string): string {
    const cleanPath = vfsPath.startsWith('/') ? vfsPath.slice(1) : vfsPath;
    return join(rootPath, cleanPath);
  }
}

// ============================================================================
// LRU CACHE FOR MEMORY MANAGEMENT
// ============================================================================

class LRUCache<K, V> {
  private readonly cache = new Map<K, V>();
  private readonly accessOrder: K[] = [];
  private currentSize = 0;

  constructor(
    private readonly maxSize: number,
    private readonly getSizeOf: (value: V) => number,
    private readonly onEvict?: (key: K, value: V) => void
  ) {}

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      this.updateAccessOrder(key);
    }
    return value;
  }

  set(key: K, value: V): void {
    const existingValue = this.cache.get(key);
    const valueSize = this.getSizeOf(value);

    if (existingValue !== undefined) {
      this.currentSize -= this.getSizeOf(existingValue);
      this.cache.delete(key);
      const index = this.accessOrder.indexOf(key);
      if (index > -1) {
        this.accessOrder.splice(index, 1);
      }
    }

    while (this.currentSize + valueSize > this.maxSize && this.accessOrder.length > 0) {
      this.evictLRU();
    }

    this.cache.set(key, value);
    this.accessOrder.push(key);
    this.currentSize += valueSize;
  }

  delete(key: K): boolean {
    const value = this.cache.get(key);
    if (value === undefined) {
      return false;
    }

    this.currentSize -= this.getSizeOf(value);
    this.cache.delete(key);

    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }

    return true;
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    if (this.onEvict) {
      for (const [key, value] of this.cache.entries()) {
        this.onEvict(key, value);
      }
    }
    this.cache.clear();
    this.accessOrder.length = 0;
    this.currentSize = 0;
  }

  get size(): number {
    return this.currentSize;
  }

  get count(): number {
    return this.cache.size;
  }

  private updateAccessOrder(key: K): void {
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
      this.accessOrder.push(key);
    }
  }

  private evictLRU(): void {
    const oldestKey = this.accessOrder.shift();
    if (oldestKey !== undefined) {
      const value = this.cache.get(oldestKey);
      if (value !== undefined) {
        this.currentSize -= this.getSizeOf(value);
        this.cache.delete(oldestKey);
        if (this.onEvict) {
          this.onEvict(oldestKey, value);
        }
      }
    }
  }
}

// ============================================================================
// AST PARSER & INDEXER
// ============================================================================

class ASTParser {
  private readonly compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    allowJs: true,
    checkJs: false,
    noResolve: true,
  };

  parse(filePath: string, content: string): ASTContext {
    const startTime = performance.now();

    try {
      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.ESNext,
        true
      );

      const imports = this.extractImports(sourceFile);
      const exports = this.extractExports(sourceFile);
      const types = this.extractTypes(sourceFile);
      const dependencies = this.extractDependencies(imports);
      const tokens = this.estimateTokens(content);
      const hash = this.hashContent(content);

      const parseTime = performance.now() - startTime;

      return {
        filePath,
        imports,
        exports,
        types,
        dependencies,
        tokens,
        parseTime,
        hash,
      };
    } catch (error) {
      throw new ASTParseError(
        filePath,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private extractImports(sourceFile: ts.SourceFile): ReadonlyArray<ImportDeclaration> {
    const imports: ImportDeclaration[] = [];

    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node)) {
        const moduleSpecifier = node.moduleSpecifier;
        if (ts.isStringLiteral(moduleSpecifier)) {
          const specifiers: string[] = [];
          
          if (node.importClause) {
            if (node.importClause.name) {
              specifiers.push(node.importClause.name.text);
            }

            if (node.importClause.namedBindings) {
              if (ts.isNamedImports(node.importClause.namedBindings)) {
                for (const element of node.importClause.namedBindings.elements) {
                  specifiers.push(element.name.text);
                }
              } else if (ts.isNamespaceImport(node.importClause.namedBindings)) {
                specifiers.push(node.importClause.namedBindings.name.text);
              }
            }
          }

          imports.push({
            source: moduleSpecifier.text,
            specifiers,
            isTypeOnly: node.importClause?.isTypeOnly ?? false,
            line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          });
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return imports;
  }

  private extractExports(sourceFile: ts.SourceFile): ReadonlyArray<ExportDeclaration> {
    const exports: ExportDeclaration[] = [];

    const visit = (node: ts.Node): void => {
      if (ts.isExportDeclaration(node)) {
        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const element of node.exportClause.elements) {
            exports.push({
              name: element.name.text,
              kind: 'const',
              isDefault: false,
              line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            });
          }
        }
      }

      if (ts.isExportAssignment(node)) {
        exports.push({
          name: 'default',
          kind: 'const',
          isDefault: true,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        });
      }

      if (ts.isVariableStatement(node) && this.hasExportModifier(node)) {
        for (const declaration of node.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) {
            exports.push({
              name: declaration.name.text,
              kind: ts.isVariableDeclarationList(node.declarationList)
                ? (node.declarationList.flags & ts.NodeFlags.Const ? 'const'
                  : node.declarationList.flags & ts.NodeFlags.Let ? 'let'
                  : 'var')
                : 'const',
              isDefault: false,
              line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            });
          }
        }
      }

      if (ts.isFunctionDeclaration(node) && this.hasExportModifier(node) && node.name) {
        exports.push({
          name: node.name.text,
          kind: 'function',
          isDefault: this.hasDefaultModifier(node),
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        });
      }

      if (ts.isClassDeclaration(node) && this.hasExportModifier(node) && node.name) {
        exports.push({
          name: node.name.text,
          kind: 'class',
          isDefault: this.hasDefaultModifier(node),
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        });
      }

      if (ts.isInterfaceDeclaration(node) && this.hasExportModifier(node)) {
        exports.push({
          name: node.name.text,
          kind: 'interface',
          isDefault: false,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        });
      }

      if (ts.isTypeAliasDeclaration(node) && this.hasExportModifier(node)) {
        exports.push({
          name: node.name.text,
          kind: 'type',
          isDefault: false,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        });
      }

      if (ts.isEnumDeclaration(node) && this.hasExportModifier(node)) {
        exports.push({
          name: node.name.text,
          kind: 'enum',
          isDefault: false,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        });
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return exports;
  }

  private extractTypes(sourceFile: ts.SourceFile): ReadonlyArray<TypeDefinition> {
    const types: TypeDefinition[] = [];

    const visit = (node: ts.Node): void => {
      if (ts.isInterfaceDeclaration(node)) {
        types.push({
          name: node.name.text,
          kind: 'interface',
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          documentation: this.getDocumentation(node),
        });
      }

      if (ts.isTypeAliasDeclaration(node)) {
        types.push({
          name: node.name.text,
          kind: 'type',
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          documentation: this.getDocumentation(node),
        });
      }

      if (ts.isClassDeclaration(node) && node.name) {
        types.push({
          name: node.name.text,
          kind: 'class',
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          documentation: this.getDocumentation(node),
        });
      }

      if (ts.isEnumDeclaration(node)) {
        types.push({
          name: node.name.text,
          kind: 'enum',
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          documentation: this.getDocumentation(node),
        });
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return types;
  }

  private extractDependencies(imports: ReadonlyArray<ImportDeclaration>): ReadonlyArray<string> {
    return imports
      .map(imp => imp.source)
      .filter(source => source.startsWith('.') || source.startsWith('/'));
  }

  private estimateTokens(content: string): number {
    return Math.ceil(content.length / 4);
  }

  private hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  private getDocumentation(node: ts.Node): string | undefined {
    const jsDocTags = ts.getJSDocTags(node);
    if (jsDocTags.length > 0) {
      return jsDocTags.map(tag => tag.comment).filter(Boolean).join('\n');
    }
    return undefined;
  }

  private hasExportModifier(node: ts.Node): boolean {
    if (!ts.canHaveModifiers(node)) return false;
    const modifiers = ts.getModifiers(node);
    return modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  }

  private hasDefaultModifier(node: ts.Node): boolean {
    if (!ts.canHaveModifiers(node)) return false;
    const modifiers = ts.getModifiers(node);
    return modifiers?.some(mod => mod.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
  }
}

// ============================================================================
// DEPENDENCY GRAPH BUILDER
// ============================================================================

class DependencyGraphBuilder {
  build(astContexts: Map<string, ASTContext>): DependencyGraph {
    const nodes = new Map<string, DependencyNode>();

    for (const [path, ast] of astContexts.entries()) {
      nodes.set(path, {
        path,
        imports: new Set(ast.dependencies),
        importedBy: new Set(),
        exports: ast.exports.map(exp => exp.name),
        depth: 0,
      });
    }

    for (const [path, node] of nodes.entries()) {
      for (const importPath of node.imports) {
        const resolvedPath = this.resolveImport(path, importPath, nodes);
        if (resolvedPath && nodes.has(resolvedPath)) {
          const importedNode = nodes.get(resolvedPath)!;
          importedNode.importedBy.add(path);
        }
      }
    }

    this.calculateDepths(nodes);

    const roots: string[] = [];
    const leaves: string[] = [];

    for (const [path, node] of nodes.entries()) {
      if (node.imports.size === 0) {
        roots.push(path);
      }
      if (node.importedBy.size === 0) {
        leaves.push(path);
      }
    }

    return { nodes, roots, leaves };
  }

  private resolveImport(
    fromPath: string,
    importPath: string,
    nodes: Map<string, DependencyNode>
  ): string | null {
    if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
      return null;
    }

    const fromDir = dirname(fromPath);
    let resolved = join(fromDir, importPath);

    const extensions = ['', '.ts', '.tsx', '.js', '.jsx'];
    for (const ext of extensions) {
      const candidate = resolved + ext;
      if (nodes.has(candidate)) {
        return candidate;
      }
    }

    for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
      const candidate = join(resolved, `index${ext}`);
      if (nodes.has(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private calculateDepths(nodes: Map<string, DependencyNode>): void {
    const visited = new Set<string>();

    const visit = (path: string, depth: number): void => {
      if (visited.has(path)) return;
      visited.add(path);

      const node = nodes.get(path);
      if (!node) return;

      if (depth > node.depth) {
        (node as { depth: number }).depth = depth;
      }

      for (const importPath of node.imports) {
        const resolvedPath = this.resolveImport(path, importPath, nodes);
        if (resolvedPath) {
          visit(resolvedPath, depth + 1);
        }
      }
    };

    for (const path of nodes.keys()) {
      visit(path, 0);
    }
  }
}

// ============================================================================
// FILE WATCHER WITH DEBOUNCING
// ============================================================================

class FileWatcher {
  private readonly watchers = new Map<string, AbortController>();
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
  private readonly debounceMs = 300;

  constructor(
    private readonly eventBus: TypedEventEmitter<VFSEventMap>,
    private readonly onFileChange: (path: string, event: 'change' | 'rename') => void
  ) {}

  async watch(path: string): Promise<void> {
    if (this.watchers.has(path)) {
      return;
    }

    try {
      const controller = new AbortController();
      this.watchers.set(path, controller);

      const watcher = fsWatch(path, { recursive: true, signal: controller.signal });

      for await (const event of watcher) {
        if (event.filename) {
          const fullPath = join(path, event.filename);
          this.debounceChange(fullPath, event.eventType as 'change' | 'rename');
        }
      }
    } catch (error) {
      this.watchers.delete(path);
    }
  }

  private debounceChange(path: string, event: 'change' | 'rename'): void {
    const existingTimer = this.debounceTimers.get(path);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(path);
      this.onFileChange(path, event);
    }, this.debounceMs);

    this.debounceTimers.set(path, timer);
  }

  unwatch(path: string): void {
    const controller = this.watchers.get(path);
    if (controller) {
      controller.abort();
      this.watchers.delete(path);
    }

    const timer = this.debounceTimers.get(path);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(path);
    }
  }

  unwatchAll(): void {
    for (const path of this.watchers.keys()) {
      this.unwatch(path);
    }
  }
}

// ============================================================================
// VIRTUAL FILE SYSTEM
// ============================================================================

class VirtualFileSystem extends TypedEventEmitter<VFSEventMap> {
  private readonly root: VFSDirectoryNode;
  private readonly rootPath: string;
  private readonly astParser: ASTParser;
  private readonly graphBuilder: DependencyGraphBuilder;
  private readonly fileCache: LRUCache<string, Buffer>;
  private readonly astCache: Map<string, ASTContext>;
  private readonly diffLog: FileDiff[] = [];
  private readonly fileWatcher: FileWatcher;
  private readonly maxMemory: number;
  private readonly syncQueue: Set<string> = new Set();
  private syncInProgress = false;

  private stats = {
    cacheHits: 0,
    cacheMisses: 0,
  };

  constructor(
    rootPath: string,
    maxMemoryMB = 512
  ) {
    super();

    this.rootPath = resolve(rootPath);
    this.maxMemory = maxMemoryMB * 1024 * 1024;

    this.root = {
      path: '/',
      name: '/',
      type: 'directory',
      metadata: {
        created: Date.now(),
        modified: Date.now(),
        accessed: Date.now(),
        size: 0,
        hash: '',
      },
      parent: null,
      children: new Map(),
    };

    this.astParser = new ASTParser();
    this.graphBuilder = new DependencyGraphBuilder();
    this.astCache = new Map();

    this.fileCache = new LRUCache<string, Buffer>(
      this.maxMemory,
      (buffer: Buffer) => buffer.length,
      (path: string, buffer: Buffer) => {
        this.emit('cache:evicted', { path, size: buffer.length });
      }
    );

    this.fileWatcher = new FileWatcher(this, this.handleFileSystemChange.bind(this));
  }

  async createFile(
    path: string,
    content: string | Buffer,
    encoding: BufferEncoding = 'utf8'
  ): Promise<VFSFileNode> {
    const validatedPath = PathValidator.validate(path, this.rootPath);
    const vfsPath = PathValidator.toVFSPath(validatedPath, this.rootPath);

    if (this.nodeExists(vfsPath)) {
      throw new FileExistsError(vfsPath);
    }

    const parentPath = dirname(vfsPath);
    await this.ensureDirectory(parentPath);

    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, encoding);
    const now = Date.now();

    const fileNode: VFSFileNode = {
      path: vfsPath,
      name: basename(vfsPath),
      type: 'file',
      content: buffer,
      encoding,
      dirty: true,
      ast: null,
      metadata: {
        created: now,
        modified: now,
        accessed: now,
        size: buffer.length,
        hash: this.hashBuffer(buffer),
      },
      parent: this.getNode(parentPath) as VFSDirectoryNode,
    };

    const parent = this.getNode(parentPath);
    if (parent && parent.type === 'directory') {
      (parent as any).children.set(fileNode.name, fileNode);
    }

    this.fileCache.set(vfsPath, buffer);

    if (this.isParseableFile(vfsPath)) {
      await this.parseAndIndexAST(fileNode);
    }

    this.syncQueue.add(vfsPath);
    void this.processSyncQueue();

    this.diffLog.push({
      path: vfsPath,
      type: 'created',
      timestamp: now,
      newHash: fileNode.metadata.hash,
      sizeChange: buffer.length,
    });

    this.emit('file:created', { path: vfsPath, node: fileNode });

    return fileNode;
  }

  async readFile(path: string, encoding?: BufferEncoding): Promise<string | Buffer> {
    const validatedPath = PathValidator.validate(path, this.rootPath);
    const vfsPath = PathValidator.toVFSPath(validatedPath, this.rootPath);

    const node = this.getNode(vfsPath);
    if (!node || node.type !== 'file') {
      throw new FileNotFoundError(vfsPath);
    }

    const fileNode = node as VFSFileNode;

    fileNode.metadata = {
      ...fileNode.metadata,
      accessed: Date.now(),
    };

    this.emit('file:accessed', { path: vfsPath, node: fileNode });

    let buffer = this.fileCache.get(vfsPath);

    if (buffer) {
      this.stats.cacheHits++;
    } else {
      this.stats.cacheMisses++;

      if (!fileNode.dirty && !this.syncQueue.has(vfsPath)) {
        const absolutePath = PathValidator.toAbsolutePath(vfsPath, this.rootPath);
        try {
          buffer = await readFile(absolutePath);
          fileNode.content = buffer;
          this.fileCache.set(vfsPath, buffer);
        } catch (error) {
          throw new VFSError(
            `Failed to read file from disk: ${vfsPath}`,
            'DISK_READ_ERROR',
            vfsPath,
            { originalError: error instanceof Error ? error.message : String(error) }
          );
        }
      } else {
        buffer = fileNode.content;
        this.fileCache.set(vfsPath, buffer);
      }
    }

    return encoding ? buffer.toString(encoding) : buffer;
  }

  async writeFile(
    path: string,
    content: string | Buffer,
    encoding: BufferEncoding = 'utf8'
  ): Promise<void> {
    const validatedPath = PathValidator.validate(path, this.rootPath);
    const vfsPath = PathValidator.toVFSPath(validatedPath, this.rootPath);

    const node = this.getNode(vfsPath);
    if (!node || node.type !== 'file') {
      await this.createFile(path, content, encoding);
      return;
    }

    const fileNode = node as VFSFileNode;
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, encoding);
    const oldHash = fileNode.metadata.hash;
    const newHash = this.hashBuffer(buffer);

    if (oldHash === newHash) {
      return;
    }

    const oldSize = fileNode.metadata.size;
    const now = Date.now();

    fileNode.content = buffer;
    fileNode.encoding = encoding;
    fileNode.dirty = true;
    fileNode.metadata = {
      ...fileNode.metadata,
      modified: now,
      accessed: now,
      size: buffer.length,
      hash: newHash,
    };

    this.fileCache.set(vfsPath, buffer);

    if (this.isParseableFile(vfsPath)) {
      await this.parseAndIndexAST(fileNode);
    }

    this.syncQueue.add(vfsPath);
    void this.processSyncQueue();

    const diff: FileDiff = {
      path: vfsPath,
      type: 'modified',
      timestamp: now,
      oldHash,
      newHash,
      sizeChange: buffer.length - oldSize,
    };

    this.diffLog.push(diff);

    this.emit('file:modified', { path: vfsPath, node: fileNode, diff });
  }

  async deleteFile(path: string): Promise<void> {
    const validatedPath = PathValidator.validate(path, this.rootPath);
    const vfsPath = PathValidator.toVFSPath(validatedPath, this.rootPath);

    const node = this.getNode(vfsPath);
    if (!node || node.type !== 'file') {
      throw new FileNotFoundError(vfsPath);
    }

    const fileNode = node as VFSFileNode;
    const metadata = { ...fileNode.metadata };

    if (fileNode.parent) {
      (fileNode.parent as any).children.delete(fileNode.name);
    }

    this.fileCache.delete(vfsPath);
    this.astCache.delete(vfsPath);

    const absolutePath = PathValidator.toAbsolutePath(vfsPath, this.rootPath);
    try {
      await unlink(absolutePath);
    } catch (error) {
      // File might not exist on disk
    }

    this.syncQueue.delete(vfsPath);

    this.diffLog.push({
      path: vfsPath,
      type: 'deleted',
      timestamp: Date.now(),
      oldHash: metadata.hash,
      sizeChange: -metadata.size,
    });

    this.emit('file:deleted', { path: vfsPath, metadata });
  }

  async createDirectory(path: string): Promise<VFSDirectoryNode> {
    const validatedPath = PathValidator.validate(path, this.rootPath);
    const vfsPath = PathValidator.toVFSPath(validatedPath, this.rootPath);

    if (this.nodeExists(vfsPath)) {
      return this.getNode(vfsPath) as VFSDirectoryNode;
    }

    const parentPath = dirname(vfsPath);
    if (parentPath !== '/' && !this.nodeExists(parentPath)) {
      await this.createDirectory(parentPath);
    }

    const now = Date.now();
    const dirNode: VFSDirectoryNode = {
      path: vfsPath,
      name: basename(vfsPath),
      type: 'directory',
      metadata: {
        created: now,
        modified: now,
        accessed: now,
        size: 0,
        hash: '',
      },
      parent: vfsPath === '/' ? null : (this.getNode(parentPath) as VFSDirectoryNode),
      children: new Map(),
    };

    if (dirNode.parent) {
      (dirNode.parent as any).children.set(dirNode.name, dirNode);
    }

    const absolutePath = PathValidator.toAbsolutePath(vfsPath, this.rootPath);
    try {
      await mkdir(absolutePath, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }

    this.emit('directory:created', { path: vfsPath, node: dirNode });

    return dirNode;
  }

  async listDirectory(path: string): Promise<ReadonlyArray<VFSNode>> {
    const validatedPath = PathValidator.validate(path, this.rootPath);
    const vfsPath = PathValidator.toVFSPath(validatedPath, this.rootPath);

    const node = this.getNode(vfsPath);
    if (!node || node.type !== 'directory') {
      throw new DirectoryNotFoundError(vfsPath);
    }

    const dirNode = node as VFSDirectoryNode;
    return Array.from(dirNode.children.values());
  }

  async deleteDirectory(path: string, recursive = false): Promise<void> {
    const validatedPath = PathValidator.validate(path, this.rootPath);
    const vfsPath = PathValidator.toVFSPath(validatedPath, this.rootPath);

    const node = this.getNode(vfsPath);
    if (!node || node.type !== 'directory') {
      throw new DirectoryNotFoundError(vfsPath);
    }

    const dirNode = node as VFSDirectoryNode;

    if (!recursive && dirNode.children.size > 0) {
      throw new VFSError(
        `Directory not empty: ${vfsPath}`,
        'DIRECTORY_NOT_EMPTY',
        vfsPath
      );
    }

    for (const child of dirNode.children.values()) {
      if (child.type === 'file') {
        await this.deleteFile(child.path);
      } else {
        await this.deleteDirectory(child.path, true);
      }
    }

    if (dirNode.parent) {
      (dirNode.parent as any).children.delete(dirNode.name);
    }

    const absolutePath = PathValidator.toAbsolutePath(vfsPath, this.rootPath);
    try {
      await rmdir(absolutePath);
    } catch (error) {
      // Directory might not exist on disk
    }

    this.emit('directory:deleted', { path: vfsPath, metadata: dirNode.metadata });
  }

  private async parseAndIndexAST(fileNode: VFSFileNode): Promise<void> {
    try {
      const content = fileNode.content.toString(fileNode.encoding);
      const ast = this.astParser.parse(fileNode.path, content);

      fileNode.ast = ast;
      this.astCache.set(fileNode.path, ast);

      this.emit('ast:updated', { path: fileNode.path, ast });
    } catch (error) {
      const astError = error instanceof ASTParseError
        ? error
        : new ASTParseError(fileNode.path, error instanceof Error ? error.message : String(error));

      this.emit('ast:error', { path: fileNode.path, error: astError });
    }
  }

  buildDependencyGraph(): DependencyGraph {
    return this.graphBuilder.build(this.astCache);
  }

  async getAIContext(query: AIContextQuery): Promise<AIContext> {
    const {
      entryPoint,
      maxDepth = 3,
      maxTokens = 100000,
      includeTypes = true,
      includeTests = false,
    } = query;

    const validatedPath = PathValidator.validate(entryPoint, this.rootPath);
    const vfsPath = PathValidator.toVFSPath(validatedPath, this.rootPath);

    const graph = this.buildDependencyGraph();
    const files: string[] = [];
    const content = new Map<string, string>();
    let totalTokens = 0;
    let truncated = false;

    const visited = new Set<string>();
    const queue: Array<{ path: string; depth: number }> = [{ path: vfsPath, depth: 0 }];

    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;

      const { path: currentPath, depth } = item;

      if (visited.has(currentPath) || depth > maxDepth) {
        continue;
      }

      visited.add(currentPath);

      if (!includeTests && this.isTestFile(currentPath)) {
        continue;
      }

      const ast = this.astCache.get(currentPath);
      if (!ast) {
        continue;
      }

      if (totalTokens + ast.tokens > maxTokens) {
        truncated = true;
        break;
      }

      files.push(currentPath);
      const fileContent = await this.readFile(currentPath, 'utf8') as string;
      content.set(currentPath, fileContent);
      totalTokens += ast.tokens;

      const node = graph.nodes.get(currentPath);
      if (node) {
        for (const dep of node.imports) {
          queue.push({ path: dep, depth: depth + 1 });
        }
      }
    }

    return {
      files,
      content,
      dependencies: graph,
      totalTokens,
      truncated,
    };
  }

  private async processSyncQueue(): Promise<void> {
    if (this.syncInProgress || this.syncQueue.size === 0) {
      return;
    }

    this.syncInProgress = true;

    const batch = Array.from(this.syncQueue).slice(0, 10);
    
    for (const vfsPath of batch) {
      this.syncQueue.delete(vfsPath);
      await this.syncToDisk(vfsPath);
    }

    this.syncInProgress = false;

    if (this.syncQueue.size > 0) {
      void this.processSyncQueue();
    }
  }

  private async syncToDisk(vfsPath: string): Promise<void> {
    const startTime = performance.now();

    this.emit('sync:start', { path: vfsPath });

    try {
      const node = this.getNode(vfsPath);
      if (!node || node.type !== 'file') {
        return;
      }

      const fileNode = node as VFSFileNode;
      if (!fileNode.dirty) {
        return;
      }

      const absolutePath = PathValidator.toAbsolutePath(vfsPath, this.rootPath);

      const parentDir = dirname(absolutePath);
      await mkdir(parentDir, { recursive: true });

      await writeFile(absolutePath, fileNode.content);

      fileNode.dirty = false;

      const duration = performance.now() - startTime;
      this.emit('sync:complete', { path: vfsPath, duration });
    } catch (error) {
      const syncError = new VFSError(
        `Failed to sync file to disk: ${vfsPath}`,
        'SYNC_ERROR',
        vfsPath,
        { originalError: error instanceof Error ? error.message : String(error) }
      );

      this.emit('sync:error', { path: vfsPath, error: syncError });
      this.emit('error', syncError);
    }
  }

  async syncAll(): Promise<void> {
    const dirtyFiles = this.findDirtyFiles(this.root);

    for (const filePath of dirtyFiles) {
      await this.syncToDisk(filePath);
    }
  }

  async loadFromDisk(path: string = '/'): Promise<void> {
    const validatedPath = PathValidator.validate(path, this.rootPath);
    const absolutePath = PathValidator.toAbsolutePath(path, this.rootPath);

    try {
      const stats = await stat(absolutePath);

      if (stats.isDirectory()) {
        await this.createDirectory(path);

        const entries = await readdir(absolutePath);

        for (const entry of entries) {
          const entryPath = join(path, entry);
          await this.loadFromDisk(entryPath);
        }
      } else if (stats.isFile()) {
        const content = await readFile(absolutePath);
        await this.createFile(path, content);
      }
    } catch (error) {
      // Skip files that can't be read
    }
  }

  async startWatching(): Promise<void> {
    await this.fileWatcher.watch(this.rootPath);
  }

  stopWatching(): void {
    this.fileWatcher.unwatchAll();
  }

  private async handleFileSystemChange(
    absolutePath: string,
    event: 'change' | 'rename'
  ): Promise<void> {
    const vfsPath = PathValidator.toVFSPath(absolutePath, this.rootPath);

    try {
      const stats = await stat(absolutePath);

      if (event === 'rename' || !this.nodeExists(vfsPath)) {
        if (stats.isFile()) {
          const content = await readFile(absolutePath);
          await this.createFile(vfsPath, content);
        } else if (stats.isDirectory()) {
          await this.createDirectory(vfsPath);
        }
      } else {
        if (stats.isFile()) {
          const content = await readFile(absolutePath);
          await this.writeFile(vfsPath, content);
        }
      }
    } catch (error) {
      if (this.nodeExists(vfsPath)) {
        const node = this.getNode(vfsPath);
        if (node?.type === 'file') {
          await this.deleteFile(vfsPath);
        } else if (node?.type === 'directory') {
          await this.deleteDirectory(vfsPath, true);
        }
      }
    }
  }

  private getNode(vfsPath: string): VFSNode | null {
    if (vfsPath === '/') {
      return this.root;
    }

    const parts = vfsPath.split('/').filter(Boolean);
    let current: VFSNode = this.root;

    for (const part of parts) {
      if (current.type !== 'directory') {
        return null;
      }

      const child = (current as any).children.get(part);
      if (!child) {
        return null;
      }

      current = child;
    }

    return current;
  }

  private nodeExists(vfsPath: string): boolean {
    return this.getNode(vfsPath) !== null;
  }

  private async ensureDirectory(vfsPath: string): Promise<void> {
    if (vfsPath === '/' || this.nodeExists(vfsPath)) {
      return;
    }

    await this.createDirectory(vfsPath);
  }

  private isParseableFile(path: string): boolean {
    const ext = extname(path);
    return ['.ts', '.tsx', '.js', '.jsx'].includes(ext);
  }

  private isTestFile(path: string): boolean {
    const name = basename(path);
    return (
      name.includes('.test.') ||
      name.includes('.spec.') ||
      path.includes('/__tests__/') ||
      path.includes('/test/')
    );
  }

  private hashBuffer(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  private findDirtyFiles(node: VFSNode, result: string[] = []): string[] {
    if (node.type === 'file') {
      const fileNode = node as VFSFileNode;
      if (fileNode.dirty) {
        result.push(node.path);
      }
    } else if (node.type === 'directory') {
      const dirNode = node as VFSDirectoryNode;
      for (const child of dirNode.children.values()) {
        this.findDirtyFiles(child, result);
      }
    }

    return result;
  }

  getStats(): VFSStats {
    let totalFiles = 0;
    let totalDirectories = 0;
    let totalSize = 0;
    let dirtyFiles = 0;

    const traverse = (node: VFSNode): void => {
      if (node.type === 'file') {
        totalFiles++;
        totalSize += node.metadata.size;
        if ((node as VFSFileNode).dirty) {
          dirtyFiles++;
        }
      } else {
        totalDirectories++;
        for (const child of (node as VFSDirectoryNode).children.values()) {
          traverse(child);
        }
      }
    };

    traverse(this.root);

    return {
      totalFiles,
      totalDirectories,
      totalSize,
      memoryUsage: this.fileCache.size,
      cacheHits: this.stats.cacheHits,
      cacheMisses: this.stats.cacheMisses,
      dirtyFiles,
      astIndexed: this.astCache.size,
    };
  }

  getDiffLog(): ReadonlyArray<FileDiff> {
    return [...this.diffLog];
  }

  clearDiffLog(): void {
    this.diffLog.length = 0;
  }

  async dispose(): Promise<void> {
    await this.syncAll();
    this.stopWatching();
    this.fileCache.clear();
    this.astCache.clear();
    this.removeAllListeners();

    if (global.gc) {
      global.gc();
    }
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  VirtualFileSystem,
  VFSError,
  PathTraversalError,
  FileNotFoundError,
  DirectoryNotFoundError,
  FileExistsError,
  InvalidPathError,
  ASTParseError,
  MemoryLimitError,
};

export type {
  VFSNode,
  VFSFileNode,
  VFSDirectoryNode,
  VFSNodeMetadata,
  ImportDeclaration,
  ExportDeclaration,
  TypeDefinition,
  ASTContext,
  DependencyNode,
  DependencyGraph,
  FileDiff,
  VFSEventMap,
  VFSStats,
  AIContextQuery,
  AIContext,
};

export function createVFS(rootPath: string, maxMemoryMB?: number): VirtualFileSystem {
  return new VirtualFileSystem(rootPath, maxMemoryMB);
}
