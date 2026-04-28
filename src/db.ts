import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import fs from 'fs';
import path from 'path';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

const DEFAULT_DB_PATH = path.resolve(process.cwd(), 'data/billing.db');

let _rawDb: Database.Database | null = null;
let _db: Db | null = null;

function getRawDb(dbPath?: string): Database.Database {
  if (_rawDb) return _rawDb;
  const resolved = dbPath ?? process.env.BILLING_DB_PATH ?? DEFAULT_DB_PATH;
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  _rawDb = new Database(resolved);
  _rawDb.pragma('journal_mode = WAL');
  _rawDb.pragma('foreign_keys = ON');
  return _rawDb;
}

export function getDb(dbPath?: string): Db {
  if (_db) return _db;
  const rawDb = getRawDb(dbPath);
  _db = drizzle(rawDb, { schema });
  return _db;
}

export function closeDb(): void {
  if (_rawDb) {
    _rawDb.close();
    _rawDb = null;
    _db = null;
  }
}

export function runMigrations(db: Db): void {
  db.$client.exec(`
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
