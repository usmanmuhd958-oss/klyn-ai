// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
// FILE: kernel/src/ast/context_graph.ts

interface SymbolNode {
  name: string;
  type: 'class' | 'function' | 'interface' | 'type' | 'variable' | 'import' | 'export';
  filePath: string;
  startLine: number;
  endLine: number;
  sourceCode: string;
  dependencies: string[];
  dependents: string[];
  metadata: {
    isExported: boolean;
    isDefault: boolean;
    extends: string[];
    implements: string[];
    typeParameters: string[];
  };
}

interface ASTGraph {
  nodes: Map<string, SymbolNode>;
  fileSymbols: Map<string, string[]>;
  reverseImports: Map<string, Set<string>>;
}

interface ContextResolutionResult {
  primarySymbol: SymbolNode | null;
  dependencies: SymbolNode[];
  tokensUsed: number;
  includedSymbols: string[];
  excludedSymbols: string[];
}

interface ParsedImport {
  symbols: string[];
  source: string;
  isDefault: boolean;
}

class ASTContextGraphEngine {
  private readonly estimatedTokensPerLine: number;

  constructor(estimatedTokensPerLine: number = 4) {
    this.estimatedTokensPerLine = estimatedTokensPerLine;
  }

  buildGraph(files: Map<string, string>): ASTGraph {
    const nodes = new Map<string, SymbolNode>();
    const fileSymbols = new Map<string, string[]>();
    const reverseImports = new Map<string, Set<string>>();

    for (const [filePath, content] of files.entries()) {
      const symbols = this.parseFile(filePath, content);
      const symbolNames: string[] = [];

      for (const symbol of symbols) {
        const key = this.getSymbolKey(symbol.name, filePath);
        nodes.set(key, symbol);
        symbolNames.push(key);

        for (const dep of symbol.dependencies) {
          if (!reverseImports.has(dep)) {
            reverseImports.set(dep, new Set());
          }
          reverseImports.get(dep)!.add(key);
        }
      }

      fileSymbols.set(filePath, symbolNames);
    }

    this.linkDependents(nodes);

    return { nodes, fileSymbols, reverseImports };
  }

  resolveContextForSymbol(
    symbolName: string,
    maxTokenBudget: number,
    graph: ASTGraph
  ): ContextResolutionResult {
    const primarySymbol = this.findSymbol(symbolName, graph);

    if (!primarySymbol) {
      return {
        primarySymbol: null,
        dependencies: [],
        tokensUsed: 0,
        includedSymbols: [],
        excludedSymbols: [],
      };
    }

    const visited = new Set<string>();
    const dependencies: SymbolNode[] = [];
    const included: string[] = [primarySymbol.name];
    const excluded: string[] = [];

    let tokensUsed = this.estimateTokens(primarySymbol.sourceCode);

    const queue: string[] = [...primarySymbol.dependencies];

    while (queue.length > 0) {
      const depName = queue.shift()!;

      if (visited.has(depName)) {
        continue;
      }

      visited.add(depName);

      const depSymbol = this.findSymbol(depName, graph);

      if (!depSymbol) {
        continue;
      }

      const depTokens = this.estimateTokens(depSymbol.sourceCode);

      if (tokensUsed + depTokens <= maxTokenBudget) {
        dependencies.push(depSymbol);
        included.push(depSymbol.name);
        tokensUsed += depTokens;

        for (const transitiveDep of depSymbol.dependencies) {
          if (!visited.has(transitiveDep)) {
            queue.push(transitiveDep);
          }
        }
      } else {
        excluded.push(depSymbol.name);
      }
    }

    return {
      primarySymbol,
      dependencies,
      tokensUsed,
      includedSymbols: included,
      excludedSymbols: excluded,
    };
  }

  private parseFile(filePath: string, content: string): SymbolNode[] {
    const symbols: SymbolNode[] = [];
    const lines = content.split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i].trim();

      if (this.isComment(line) || line.length === 0) {
        i++;
        continue;
      }

      const classMatch = this.matchClass(line);
      if (classMatch) {
        const symbol = this.parseClass(lines, i, filePath, classMatch);
        symbols.push(symbol);
        i = symbol.endLine;
        continue;
      }

      const interfaceMatch = this.matchInterface(line);
      if (interfaceMatch) {
        const symbol = this.parseInterface(lines, i, filePath, interfaceMatch);
        symbols.push(symbol);
        i = symbol.endLine;
        continue;
      }

      const typeMatch = this.matchType(line);
      if (typeMatch) {
        const symbol = this.parseType(lines, i, filePath, typeMatch);
        symbols.push(symbol);
        i = symbol.endLine;
        continue;
      }

      const functionMatch = this.matchFunction(line);
      if (functionMatch) {
        const symbol = this.parseFunction(lines, i, filePath, functionMatch);
        symbols.push(symbol);
        i = symbol.endLine;
        continue;
      }

      const arrowMatch = this.matchArrowFunction(line);
      if (arrowMatch) {
        const symbol = this.parseArrowFunction(lines, i, filePath, arrowMatch);
        symbols.push(symbol);
        i = symbol.endLine;
        continue;
      }

      i++;
    }

    return symbols;
  }

  private matchClass(line: string): RegExpMatchArray | null {
    return line.match(/^(export\s+)?(default\s+)?(abstract\s+)?class\s+(\w+)/);
  }

  private matchInterface(line: string): RegExpMatchArray | null {
    return line.match(/^(export\s+)?interface\s+(\w+)/);
  }

  private matchType(line: string): RegExpMatchArray | null {
    return line.match(/^(export\s+)?type\s+(\w+)/);
  }

  private matchFunction(line: string): RegExpMatchArray | null {
    return line.match(/^(export\s+)?(async\s+)?function\s+(\w+)/);
  }

  private matchArrowFunction(line: string): RegExpMatchArray | null {
    return line.match(/^(export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>/);
  }

  private parseClass(
    lines: string[],
    startLine: number,
    filePath: string,
    match: RegExpMatchArray
  ): SymbolNode {
    const isExported = !!match[1];
    const isDefault = !!match[2];
    const className = match[4];
    const endLine = this.findBlockEnd(lines, startLine);
    const sourceCode = lines.slice(startLine, endLine + 1).join('\n');

    const extendsMatch = sourceCode.match(/extends\s+([\w<>,\s]+?)(?:\s+implements|\s*\{)/);
    const implementsMatch = sourceCode.match(/implements\s+([\w<>,\s]+?)\s*\{/);

    const extendsClasses = extendsMatch
      ? extendsMatch[1].split(',').map(s => s.trim()).filter(Boolean)
      : [];
    const implementsInterfaces = implementsMatch
      ? implementsMatch[1].split(',').map(s => s.trim()).filter(Boolean)
      : [];

    const typeParams = this.extractTypeParameters(sourceCode);
    const dependencies = this.extractDependencies(sourceCode);

    dependencies.push(...extendsClasses, ...implementsInterfaces);

    return {
      name: className,
      type: 'class',
      filePath,
      startLine,
      endLine,
      sourceCode,
      dependencies: Array.from(new Set(dependencies)),
      dependents: [],
      metadata: {
        isExported,
        isDefault,
        extends: extendsClasses,
        implements: implementsInterfaces,
        typeParameters: typeParams,
      },
    };
  }

  private parseInterface(
    lines: string[],
    startLine: number,
    filePath: string,
    match: RegExpMatchArray
  ): SymbolNode {
    const isExported = !!match[1];
    const interfaceName = match[2];
    const endLine = this.findBlockEnd(lines, startLine);
    const sourceCode = lines.slice(startLine, endLine + 1).join('\n');

    const extendsMatch = sourceCode.match(/extends\s+([\w<>,\s]+?)\s*\{/);
    const extendsInterfaces = extendsMatch
      ? extendsMatch[1].split(',').map(s => s.trim()).filter(Boolean)
      : [];

    const typeParams = this.extractTypeParameters(sourceCode);
    const dependencies = this.extractDependencies(sourceCode);

    dependencies.push(...extendsInterfaces);

    return {
      name: interfaceName,
      type: 'interface',
      filePath,
      startLine,
      endLine,
      sourceCode,
      dependencies: Array.from(new Set(dependencies)),
      dependents: [],
      metadata: {
        isExported,
        isDefault: false,
        extends: extendsInterfaces,
        implements: [],
        typeParameters: typeParams,
      },
    };
  }

  private parseType(
    lines: string[],
    startLine: number,
    filePath: string,
    match: RegExpMatchArray
  ): SymbolNode {
    const isExported = !!match[1];
    const typeName = match[2];
    const endLine = this.findStatementEnd(lines, startLine);
    const sourceCode = lines.slice(startLine, endLine + 1).join('\n');

    const typeParams = this.extractTypeParameters(sourceCode);
    const dependencies = this.extractDependencies(sourceCode);

    return {
      name: typeName,
      type: 'type',
      filePath,
      startLine,
      endLine,
      sourceCode,
      dependencies: Array.from(new Set(dependencies)),
      dependents: [],
      metadata: {
        isExported,
        isDefault: false,
        extends: [],
        implements: [],
        typeParameters: typeParams,
      },
    };
  }

  private parseFunction(
    lines: string[],
    startLine: number,
    filePath: string,
    match: RegExpMatchArray
  ): SymbolNode {
    const isExported = !!match[1];
    const functionName = match[3];
    const endLine = this.findBlockEnd(lines, startLine);
    const sourceCode = lines.slice(startLine, endLine + 1).join('\n');

    const dependencies = this.extractDependencies(sourceCode);

    return {
      name: functionName,
      type: 'function',
      filePath,
      startLine,
      endLine,
      sourceCode,
      dependencies: Array.from(new Set(dependencies)),
      dependents: [],
      metadata: {
        isExported,
        isDefault: false,
        extends: [],
        implements: [],
        typeParameters: [],
      },
    };
  }

  private parseArrowFunction(
    lines: string[],
    startLine: number,
    filePath: string,
    match: RegExpMatchArray
  ): SymbolNode {
    const isExported = !!match[1];
    const functionName = match[2];
    const endLine = this.findStatementEnd(lines, startLine);
    const sourceCode = lines.slice(startLine, endLine + 1).join('\n');

    const dependencies = this.extractDependencies(sourceCode);

    return {
      name: functionName,
      type: 'function',
      filePath,
      startLine,
      endLine,
      sourceCode,
      dependencies: Array.from(new Set(dependencies)),
      dependents: [],
      metadata: {
        isExported,
        isDefault: false,
        extends: [],
        implements: [],
        typeParameters: [],
      },
    };
  }

  private findBlockEnd(lines: string[], startLine: number): number {
    let braceCount = 0;
    let foundOpen = false;

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];
      for (const char of line) {
        if (char === '{') {
          braceCount++;
          foundOpen = true;
        } else if (char === '}') {
          braceCount--;
          if (foundOpen && braceCount === 0) {
            return i;
          }
        }
      }
    }

    return startLine;
  }

  private findStatementEnd(lines: string[], startLine: number): number {
    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.endsWith(';') || line.endsWith('}')) {
        return i;
      }
    }
    return startLine;
  }

  private extractTypeParameters(sourceCode: string): string[] {
    const match = sourceCode.match(/<([^>]+)>/);
    if (!match) return [];

    return match[1]
      .split(',')
      .map(p => p.trim().split(/\s+/)[0])
      .filter(Boolean);
  }

  private extractDependencies(sourceCode: string): string[] {
    const dependencies = new Set<string>();

    const importMatches = sourceCode.matchAll(/import\s+(?:\{([^}]+)\}|(\w+))\s+from/g);
    for (const match of importMatches) {
      if (match[1]) {
        const symbols = match[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]);
        symbols.forEach(s => dependencies.add(s));
      } else if (match[2]) {
        dependencies.add(match[2]);
      }
    }

    const typeRefs = sourceCode.matchAll(/:\s*([A-Z]\w+)/g);
    for (const match of typeRefs) {
      dependencies.add(match[1]);
    }

    const functionCalls = sourceCode.matchAll(/\b([a-z]\w+)\s*\(/g);
    for (const match of functionCalls) {
      const name = match[1];
      if (!this.isKeyword(name)) {
        dependencies.add(name);
      }
    }

    const newExpressions = sourceCode.matchAll(/new\s+([A-Z]\w+)/g);
    for (const match of newExpressions) {
      dependencies.add(match[1]);
    }

    return Array.from(dependencies);
  }

  private isKeyword(word: string): boolean {
    const keywords = new Set([
      'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break',
      'continue', 'return', 'throw', 'try', 'catch', 'finally',
      'const', 'let', 'var', 'function', 'class', 'interface', 'type',
      'async', 'await', 'yield', 'import', 'export', 'default',
    ]);
    return keywords.has(word);
  }

  private isComment(line: string): boolean {
    return line.startsWith('//') || line.startsWith('/*') || line.startsWith('*');
  }

  private linkDependents(nodes: Map<string, SymbolNode>): void {
    for (const [key, node] of nodes.entries()) {
      for (const dep of node.dependencies) {
        const depNode = this.findSymbolInMap(dep, nodes);
        if (depNode && !depNode.dependents.includes(node.name)) {
          depNode.dependents.push(node.name);
        }
      }
    }
  }

  private findSymbol(symbolName: string, graph: ASTGraph): SymbolNode | null {
    for (const [key, node] of graph.nodes.entries()) {
      if (node.name === symbolName) {
        return node;
      }
    }
    return null;
  }

  private findSymbolInMap(symbolName: string, nodes: Map<string, SymbolNode>): SymbolNode | null {
    for (const [key, node] of nodes.entries()) {
      if (node.name === symbolName) {
        return node;
      }
    }
    return null;
  }

  private getSymbolKey(name: string, filePath: string): string {
    return `${filePath}::${name}`;
  }

  private estimateTokens(sourceCode: string): number {
    const lines = sourceCode.split('\n').length;
    return lines * this.estimatedTokensPerLine;
  }
}

export type { SymbolNode, ASTGraph, ContextResolutionResult };
export { ASTContextGraphEngine };
