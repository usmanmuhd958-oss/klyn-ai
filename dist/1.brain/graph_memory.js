import initSqlJs from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';
export class GraphMemory {
    // @ts-ignore
    db = null;
    dbPath;
    constructor(dbPath = './knowledge_graph.db') {
        this.dbPath = path.resolve(dbPath);
    }
    async init() {
        const SQL = await initSqlJs();
        if (fs.existsSync(this.dbPath)) {
            const fileBuffer = fs.readFileSync(this.dbPath);
            this.db = new SQL.Database(fileBuffer);
        }
        else {
            this.db = new SQL.Database();
            this.createTables();
            this.save();
        }
    }
    createTables() {
        if (!this.db)
            return;
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
    save() {
        if (!this.db)
            return;
        const data = this.db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(this.dbPath, buffer);
    }
    addNode(node) {
        if (!this.db)
            return;
        const metadataStr = JSON.stringify(node.metadata || {});
        this.db.run(`INSERT OR REPLACE INTO nodes (id, label, type, metadata) VALUES (?, ?, ?, ?)`, [node.id, node.label, node.type, metadataStr]);
        this.save();
    }
    storeNode(node) {
        this.addNode(node);
    }
    addEdge(edge) {
        if (!this.db)
            return;
        this.db.run(`INSERT OR REPLACE INTO edges (id, source, target, relation, weight) VALUES (?, ?, ?, ?, ?)`, [`${edge.source}->${edge.target}`, edge.source, edge.target, edge.relation, edge.weight || 1.0]);
        this.save();
    }
    storeEdge(edge) {
        this.addEdge(edge);
    }
    store(data) {
        if (data && data.source && data.target) {
            this.addEdge(data);
        }
        else if (data && data.id) {
            this.addNode(data);
        }
    }
    getNodes() {
        if (!this.db)
            return [];
        const res = this.db.exec(`SELECT * FROM nodes`);
        if (res.length === 0)
            return [];
        return res[0].values.map((row) => ({
            id: String(row[0]),
            label: String(row[1]),
            type: String(row[2]),
            metadata: JSON.parse(String(row[3] || '{}')),
        }));
    }
    query(term) {
        if (!this.db)
            return [];
        const res = this.db.exec(`SELECT * FROM nodes WHERE label LIKE '%${term}%' OR type LIKE '%${term}%'`);
        if (res.length === 0)
            return [];
        return res[0].values;
    }
    search(query) {
        return this.query(query);
    }
    close() {
        this.save();
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }
}
export default GraphMemory;
