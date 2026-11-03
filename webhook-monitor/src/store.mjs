import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class Store {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS approvals(signature TEXT PRIMARY KEY, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(
        signature TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'pending',
        outcome TEXT, received_at TEXT NOT NULL, completed_at TEXT
      );
    `);
  }
  approve(signature) {
    this.db
      .prepare('INSERT OR IGNORE INTO approvals VALUES (?,?)')
      .run(signature, new Date().toISOString());
  }
  approved(signature) {
    return Boolean(
      this.db
        .prepare('SELECT 1 FROM approvals WHERE signature=?')
        .get(signature),
    );
  }
  enqueue(signatures) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const stmt = this.db.prepare(
        'INSERT OR IGNORE INTO jobs(signature,received_at) VALUES (?,?)',
      );
      for (const signature of signatures)
        stmt.run(signature, new Date().toISOString());
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  pending() {
    return this.db
      .prepare("SELECT * FROM jobs WHERE status='pending' ORDER BY received_at")
      .all();
  }
  complete(signature, outcome) {
    this.db
      .prepare(
        "UPDATE jobs SET status='done',outcome=?,completed_at=? WHERE signature=?",
      )
      .run(outcome, new Date().toISOString(), signature);
  }
  jobs() {
    return this.db.prepare('SELECT * FROM jobs ORDER BY received_at').all();
  }
  close() {
    this.db.close();
  }
}
