// DAGStorage.ts
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';
import dotenv from 'dotenv';

interface DAG {
  id: string;
  script: string;
  metadata?: Record<string, any>;
  timestamp: string;
}

dotenv.config();

const DB_PATH = process.env.DAG_DB_PATH || 'dags.db';

class DAGStorage {
  private db: Database | null = null;
  private dbPath: string;
  private initialized: Promise<void>;

  constructor(dbPath: string = DB_PATH) {
    this.dbPath = path.resolve(dbPath);
    // Initialize immediately and store the promise
    this.initialized = this.init();
  }

  async init(): Promise<void> {
    if (this.db) return; // Already initialized

    this.db = await open({
      filename: this.dbPath,
      driver: sqlite3.Database,
    });

    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS dags (
        id TEXT PRIMARY KEY,
        script TEXT NOT NULL,
        metadata JSON,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_timestamp ON dags(timestamp);
    `);
  }

  async saveDag(dag: DAG): Promise<void> {
    // Wait for initialization before proceeding
    await this.initialized;

    if (!this.db) throw new Error('Database not initialized');

    await this.db.run(
      `INSERT INTO dags (id, script, metadata, timestamp) 
       VALUES (?, ?, json(?), ?)`,
      [dag.id, dag.script, JSON.stringify(dag.metadata || {}), dag.timestamp]
    );
  }

  async getDag(id: string): Promise<DAG | null> {
    await this.initialized;

    if (!this.db) throw new Error('Database not initialized');

    const row = await this.db.get('SELECT * FROM dags WHERE id = ?', id);
    if (!row) return null;

    return {
      id: row.id,
      script: row.script,
      metadata: JSON.parse(row.metadata),
      timestamp: row.timestamp,
    };
  }

  async close(): Promise<void> {
    await this.initialized;

    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }
}

// Create and export a singleton instance
const dagStorage = new DAGStorage();
export default dagStorage;
