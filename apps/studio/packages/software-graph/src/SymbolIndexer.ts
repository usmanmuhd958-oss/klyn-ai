export interface SymbolEntry {
  name: string;
  file: string;
  type: string;
}

export class SymbolIndexer {
  private symbols: SymbolEntry[] = [];

  index(symbol: SymbolEntry) {
    this.symbols.push(symbol);
  }

  search(query: string) {
    return this.symbols.filter(symbol =>
      symbol.name.toLowerCase().includes(query.toLowerCase())
    );
  }
}
