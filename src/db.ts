/**
 * Sqlite connection + initial migration. Single source of truth for
 * the schema; everything else queries through here.
 *
 * The schema reflects 4 years of incremental changes — some of those
 * changes are documented in `docs/CHANGELOG.md`, some are not.
 */
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DEFAULT_DB_PATH = path.resolve(process.cwd(), 'data/billing.db');

let _db: Database.Database | null = null;

export function getDb(dbPath?: string): Database.Database {
  if (_db) return _db;
  const resolved = dbPath ?? process.env.BILLING_DB_PATH ?? DEFAULT_DB_PATH;
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  _db = new Database(resolved);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS customer (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "order" (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customer(id),
      total_cents INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subscription (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customer(id),
      plan TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      cancelled_at INTEGER
    );

    -- LineItem belongs to either an order OR a subscription.
    -- The polymorphism is implemented application-side via parent_type.
    -- See docs/POLYMORPHISM.md for the full story (and warnings).
    CREATE TABLE IF NOT EXISTS line_item (
      id TEXT PRIMARY KEY,
      parent_type TEXT NOT NULL CHECK (parent_type IN ('order', 'subscription')),
      parent_id TEXT NOT NULL,
      sku TEXT NOT NULL,
      qty INTEGER NOT NULL,
      unit_price_cents INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS line_item_parent_idx ON line_item(parent_type, parent_id);
  `);
}
