const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', '..', 'runtime', 'agent_memory.db');
let db;

function initDB() {
  const sqlite3 = require('better-sqlite3');
  db = new sqlite3(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent TEXT, task TEXT, model TEXT, result TEXT,
      response_time_ms INTEGER, success INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS knowledge (
      key TEXT PRIMARY KEY, value TEXT, confidence REAL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS model_stats (
      model TEXT PRIMARY KEY, total_calls INTEGER, success_calls INTEGER,
      avg_response_ms REAL, last_used TEXT
    );
  `);
  return db;
}

function recordTask(agent, task, model, result, responseTime, success) {
  if (!db) initDB();
  db.prepare(`INSERT INTO tasks (agent, task, model, result, response_time_ms, success) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(agent, task, model, JSON.stringify(result).substring(0, 1000), responseTime, success ? 1 : 0);
  // Update model stats
  db.prepare(`INSERT INTO model_stats (model, total_calls, success_calls, avg_response_ms, last_used) VALUES (?, 1, ?, ?, datetime('now')) ON CONFLICT(model) DO UPDATE SET total_calls = total_calls + 1, success_calls = success_calls + ?, avg_response_ms = (avg_response_ms * total_calls + ?) / (total_calls + 1), last_used = datetime('now')`)
    .run(model, success ? 1 : 0, success ? 1 : 0, responseTime);
}

function recallSimilar(task) {
  if (!db) initDB();
  return db.prepare(`SELECT result, model, success FROM tasks WHERE task LIKE ? ORDER BY created_at DESC LIMIT 5`)
    .all('%' + task.substring(0, 30) + '%');
}

function getBestModel() {
  if (!db) initDB();
  const row = db.prepare(`SELECT model FROM model_stats WHERE success_calls > 0 ORDER BY (success_calls * 1.0 / total_calls) DESC, avg_response_ms ASC LIMIT 1`).get();
  return row ? row.model : 'local';
}

function learnFact(key, value, confidence = 0.8) {
  if (!db) initDB();
  db.prepare(`INSERT OR REPLACE INTO knowledge (key, value, confidence) VALUES (?, ?, ?)`).run(key, value, confidence);
}

// CLI
if (require.main === module) {
  initDB();
  const cmd = process.argv[2];
  if (cmd === 'best') console.log(getBestModel());
  else if (cmd === 'recall') console.log(JSON.stringify(recallSimilar(process.argv[3] || '')));
  else if (cmd === 'learn') learnFact(process.argv[3], process.argv[4], parseFloat(process.argv[5]) || 0.8);
  else if (cmd === 'stats') console.log(JSON.stringify(db.prepare('SELECT * FROM model_stats').all()));
}
module.exports = { initDB, recordTask, recallSimilar, getBestModel, learnFact };
