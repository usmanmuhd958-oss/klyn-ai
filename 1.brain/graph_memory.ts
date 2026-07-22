import initSqlJs, { Database } from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  metadata?: Record<string, any>;
}

export interface GraphEdge {
  source: string;
  target: string;
  relation: string;
  weight?: number;
}

export class GraphMemory {
  [key: string]: any;
  // @ts-ignore
  private db: Database | null = null;
  private dbPath: string;

  constructor(dbPath: string = './knowledge_graph.db') {
    this.dbPath = path.resolve(dbPath);
  }

  public async init(): Promise<void> {
    const SQL = await initSqlJs();
    if (fs.existsSync(this.dbPath)) {
      const fileBuffer = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(fileBuffer);
    } else {
      this.db = new SQL.Database();
      this.createTables();
      this.save();
    }
  }

  private createTables(): void {
    if (!this.db) return;
    this.db.run(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        label TEXT,
        type TEXT,
        metadata TEXT
      );
      CREATE TABLE IF NOT EXISTS edges (
        id TEXT,
        source TEXT,
        target TEXT,
        relation TEXT,
        weight REAL,
        PRIMARY KEY (source, target, relation)
      );
    `);
  }

  public save(): void {
    if (!this.db) return;
    const data = this.db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(this.dbPath, buffer);
  }

  public addNode(node: GraphNode): void {
    if (!this.db) return;
    const metadataStr = JSON.stringify(node.metadata || {});
    this.db.run(
      `INSERT OR REPLACE INTO nodes (id, label, type, metadata) VALUES (?, ?, ?, ?)`,
      [node.id, node.label, node.type, metadataStr]
    );
    this.save();
  }

  public storeNode(node: GraphNode): void {
    this.addNode(node);
  }

  public addEdge(edge: GraphEdge): void {
    if (!this.db) return;
    this.db.run(
      `INSERT OR REPLACE INTO edges (id, source, target, relation, weight) VALUES (?, ?, ?, ?, ?)`,
      [`${edge.source}->${edge.target}`, edge.source, edge.target, edge.relation, edge.weight || 1.0]
    );
    this.save();
  }

  public storeEdge(edge: GraphEdge): void {
    this.addEdge(edge);
  }

  public store(data: any): void {
    if (data && (data as any).source && (data as any).target) {
      this.addEdge(data);
    } else if (data && (data as any).id) {
      this.addNode(data);
    }
  }

  public getNodes(): GraphNode[] {
    if (!this.db) return [];
    const res = this.db.exec(`SELECT * FROM nodes`);
    if ((res as any).length === 0) return [];
    return res[0].values.map((row) => ({
      id: String(row[0]),
      label: String(row[1]),
      type: String(row[2]),
      metadata: JSON.parse(String(row[3] || '{}')),
    }));
  }

  public query(term: string): any[] {
    if (!this.db) return [];
    const res = this.db.exec(`SELECT * FROM nodes WHERE label LIKE '%${term}%' OR type LIKE '%${term}%'`);
    if ((res as any).length === 0) return [];
    return res[0].values;
  }

  public search(query: string): any[] {
    return this.query(query);
  }

  public close(): void {
    this.save();
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

export default GraphMemory;
