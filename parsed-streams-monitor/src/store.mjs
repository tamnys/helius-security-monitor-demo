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
        signature TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'pending', outcome TEXT,
        slot INTEGER NOT NULL, collateral TEXT NOT NULL, new_admin TEXT NOT NULL,
        received_at TEXT NOT NULL, completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS alerts(
        signature TEXT PRIMARY KEY, collateral TEXT NOT NULL, new_admin TEXT NOT NULL,
        status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
  }

  approve(signature) {
    this.db.prepare('INSERT OR IGNORE INTO approvals VALUES (?,?)').run(signature, new Date().toISOString());
  }

  approved(signature) {
    return Boolean(this.db.prepare('SELECT 1 FROM approvals WHERE signature=?').get(signature));
  }

  enqueue(events) {
    if (!events.length) return;
    const now = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const stmt = this.db.prepare(`INSERT OR IGNORE INTO jobs
        (signature,slot,collateral,new_admin,received_at) VALUES (?,?,?,?,?)`);
      for (const event of events) {
        stmt.run(event.signature, event.slot, event.collateral, event.newAdmin, now);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  pending() {
    return this.db.prepare("SELECT * FROM jobs WHERE status='pending' ORDER BY slot,received_at").all();
  }

  complete(signature, outcome) {
    this.db.prepare("UPDATE jobs SET status='done',outcome=?,completed_at=? WHERE signature=?")
      .run(outcome, new Date().toISOString(), signature);
  }

  jobs() {
    return this.db.prepare('SELECT * FROM jobs ORDER BY slot,received_at').all();
  }

  alert(signature, collateral, newAdmin, status = 'pending') {
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO alerts(signature,collateral,new_admin,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?) ON CONFLICT(signature) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at`)
      .run(signature, collateral, newAdmin, status, now, now);
  }

  alerts() {
    return this.db.prepare('SELECT * FROM alerts ORDER BY created_at').all();
  }

  getMeta(key) {
    return this.db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value ?? null;
  }

  setMeta(key, value) {
    this.db.prepare(`INSERT INTO meta(key,value) VALUES (?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, String(value));
  }

  lastReconciledSlot() {
    const value = this.getMeta('last_reconciled_slot');
    return value === null ? null : Number(value);
  }

  setLastReconciledSlot(slot) {
    this.setMeta('last_reconciled_slot', slot);
  }

  close() { this.db.close(); }
}
