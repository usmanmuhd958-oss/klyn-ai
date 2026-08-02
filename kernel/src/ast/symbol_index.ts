// kernel/src/ast/symbol_index.ts
import type { ASTDependencyGraph, FileNode, SymbolImport, SymbolExport } from './dependency_graph.js';

export interface SymbolReference {
  filePath: string;
  line: number;
  type: 'import' | 'export';
  isDefault: boolean;
}

export interface SymbolInfo {
  name: string;
  definedIn: string[];
  importedIn: SymbolReference[];
  exportedFrom: SymbolReference[];
}

export class SymbolIndex {
  private symbols: Map<string, SymbolInfo> = new Map();
  private graph: ASTDependencyGraph;

  constructor(graph: ASTDependencyGraph) {
    this.graph = graph;
  }

  build(): void {
    this.symbols.clear();
    
    const allFiles = Array.from(this.getAllFiles());
    
    for (const filePath of allFiles) {
      const node = this.graph.getFileNode(filePath);
      if (!node) continue;
      
      for (const exp of node.exports) {
        this.addExport(exp, filePath);
      }
      
      for (const imp of node.imports) {
        this.addImport(imp, filePath);
      }
    }
  }

  getSymbol(name: string): SymbolInfo | undefined {
    return this.symbols.get(name);
  }

  findSymbol(pattern: string): SymbolInfo[] {
    const regex = new RegExp(pattern, 'i');
    const results: SymbolInfo[] = [];
    
    for (const [name, info] of this.symbols.entries()) {
      if (regex.test(name)) {
        results.push(info);
      }
    }
    
    return results;
  }

  getSymbolUsageCount(name: string): number {
    const info = this.symbols.get(name);
    if (!info) return 0;
    
    return info.importedIn.length + info.exportedFrom.length;
  }

  getUnusedExports(): Array<{ symbol: string; file: string }> {
    const unused: Array<{ symbol: string; file: string }> = [];
    
    for (const [name, info] of this.symbols.entries()) {
      if (info.exportedFrom.length > 0 && info.importedIn.length === 0) {
        for (const exp of info.exportedFrom) {
          unused.push({ symbol: name, file: exp.filePath });
        }
      }
    }
    
    return unused;
  }

  getAllSymbols(): string[] {
    return Array.from(this.symbols.keys()).sort();
  }

  private addExport(exp: SymbolExport, filePath: string): void {
    const symbolName = exp.symbol;
    
    let info = this.symbols.get(symbolName);
    if (!info) {
      info = {
        name: symbolName,
        definedIn: [],
        importedIn: [],
        exportedFrom: [],
      };
      this.symbols.set(symbolName, info);
    }
    
    if (!info.definedIn.includes(filePath)) {
      info.definedIn.push(filePath);
    }
    
    info.exportedFrom.push({
      filePath,
      line: exp.line,
      type: 'export',
      isDefault: exp.isDefault,
    });
  }

  private addImport(imp: SymbolImport, filePath: string): void {
    const symbolName = imp.symbol;
    
    let info = this.symbols.get(symbolName);
    if (!info) {
      info = {
        name: symbolName,
        definedIn: [],
        importedIn: [],
        exportedFrom: [],
      };
      this.symbols.set(symbolName, info);
    }
    
    info.importedIn.push({
      filePath,
      line: imp.line,
      type: 'import',
      isDefault: imp.isDefault,
    });
  }

  private *getAllFiles(): Generator<string> {
    const allPaths = this.graph.getAllFilePaths();
    for (const path of allPaths) {
      yield path;
    }
  }
}
