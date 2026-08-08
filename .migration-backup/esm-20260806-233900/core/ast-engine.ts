import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

export class ASTEngine {
  private lookupCount: number = 0;
  private startTime: number = Date.now();
  private db: DatabaseSync;

  constructor(dbPath: string = ':memory:') {
    this.db = new DatabaseSync(dbPath);
    // Dual-layer fallback: SQLite memory/disk optimized for ARM64 < 6MB RAM
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA temp_store = MEMORY;
      PRAGMA cache_size = -2000; -- Max ~2MB RAM
      PRAGMA mmap_size = 2147483648;
      
      CREATE TABLE IF NOT EXISTS ast_nodes (
        id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        node_type TEXT NOT NULL,
        name TEXT,
        dependencies TEXT,
        exports TEXT
      );
      
      CREATE INDEX IF NOT EXISTS idx_ast_lookup 
      ON ast_nodes(file_path, node_type);
    `);
  }

  public insert(file_path: string, node_type: string, name: string, dependencies: string[], exports: string[]): void {
    const stmt = this.db.prepare('INSERT OR REPLACE INTO ast_nodes (id, file_path, node_type, name, dependencies, exports) VALUES (?, ?, ?, ?, ?, ?)');
    stmt.run(`${file_path}:${name}`, file_path, node_type, name, JSON.stringify(dependencies), JSON.stringify(exports));
  }

  public lookup(file: string, nodeType: string): any {
    this.lookupCount++;
    const stmt = this.db.prepare('SELECT id, name, dependencies, exports FROM ast_nodes WHERE file_path = ? AND node_type = ? LIMIT 1');
    return stmt.get(file, nodeType);
  }

  public getMemoryUsage(): { heapUsed: number; rss: number } {
    const mem = process.memoryUsage();
    return {
      heapUsed: Number((mem.heapUsed / 1024 / 1024).toFixed(2)),
      rss: Number((mem.rss / 1024 / 1024).toFixed(2))
    };
  }

  public getLookupRate(): number {
    const elapsedSec = (Date.now() - this.startTime) / 1000 || 0.001;
    return Math.round(this.lookupCount / elapsedSec);
  }

  public shutdown(): void {
    this.db.close();
  }
}
