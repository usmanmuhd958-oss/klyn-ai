import sqlite3, json, os, time
from datetime import datetime

DB_PATH = os.path.expanduser("~/klyn-ai-os/runtime/state.db")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_schema():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS kv_store (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT,
            data TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    conn.commit()
    conn.close()

def set_state(key, value):
    conn = get_db()
    conn.execute("INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)",
                 (key, json.dumps(value), datetime.utcnow()))
    conn.commit()
    conn.close()
    # If online, sync to Supabase (pseudo)
    sync_to_supabase(key, value)

def get_state(key):
    conn = get_db()
    cur = conn.execute("SELECT value FROM kv_store WHERE key=?", (key,))
    row = cur.fetchone()
    conn.close()
    return json.loads(row['value']) if row else None

def sync_to_supabase(key, value):
    # Replace with actual Supabase call using Python client
    pass

init_schema()
