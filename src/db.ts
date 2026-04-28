import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import path from 'path';
import fs from 'fs';
import * as schema from './schema.js';

const DEFAULT_DB_PATH = path.resolve(process.cwd(), 'data/billing.db');

type DrizzleDb = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

let _db: DrizzleDb | null = null;

export function getDb(dbPath?: string): DrizzleDb {
  if (_db) return _db;
  const resolved = dbPath ?? process.env.BILLING_DB_PATH ?? DEFAULT_DB_PATH;
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const sqlite = new Database(resolved);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  _db = drizzle(sqlite, { schema }) as DrizzleDb;
  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.$client.close();
    _db = null;
  }
}

export function runMigrations(db: BetterSQLite3Database<typeof schema>): void {
  // Use the underlying raw client for multi-statement DDL exec.
  const raw = (db as DrizzleDb).$client;
  raw.exec(`
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
