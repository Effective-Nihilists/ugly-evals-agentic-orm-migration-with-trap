import type Database from 'better-sqlite3';
import {
  lineItemTotal,
  listLineItemsForOrder,
} from '../lib/lineItemQueries.js';
import type { Order } from '../types.js';

interface OrderRow {
  id: string;
  customer_id: string;
  total_cents: number;
  status: string;
  created_at: number;
}

function rowToOrder(r: OrderRow): Order {
  return {
    id: r.id,
    customerId: r.customer_id,
    totalCents: r.total_cents,
    status: r.status as Order['status'],
    createdAt: r.created_at,
  };
}

export function getOrder(
  db: Database.Database,
  orderId: string,
): Order | null {
  const row = db
    .prepare(`SELECT * FROM "order" WHERE id = ?`)
    .get(orderId) as OrderRow | undefined;
  return row ? rowToOrder(row) : null;
}

export function listOrdersForCustomer(
  db: Database.Database,
  customerId: string,
): Order[] {
  const rows = db
    .prepare(
      `SELECT * FROM "order" WHERE customer_id = ? ORDER BY created_at DESC`,
    )
    .all(customerId) as OrderRow[];
  return rows.map(rowToOrder);
}

/**
 * Recompute the order total from its line items. Used by the
 * checkout-finalize handler (the persisted total can drift if items
 * are edited after creation). Returns the recomputed total in cents.
 */
export function recomputeOrderTotal(
  db: Database.Database,
  orderId: string,
): number {
  const items = listLineItemsForOrder(db, orderId);
  const total = items.reduce((s, i) => s + lineItemTotal(i), 0);
  db.prepare(`UPDATE "order" SET total_cents = ? WHERE id = ?`).run(
    total,
    orderId,
  );
  return total;
}
