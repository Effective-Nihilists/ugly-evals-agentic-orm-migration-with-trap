import { desc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { lineItemTotal, listLineItemsForOrder } from '../lib/lineItemQueries.js';
import { order } from '../schema.js';
import type * as schema from '../schema.js';
import type { Order } from '../types.js';

type Db = BetterSQLite3Database<typeof schema>;

function rowToOrder(r: typeof order.$inferSelect): Order {
  return {
    id: r.id,
    customerId: r.customerId,
    totalCents: r.totalCents,
    status: r.status as Order['status'],
    createdAt: r.createdAt,
  };
}

export function getOrder(db: Db, orderId: string): Order | null {
  const row = db.select().from(order).where(eq(order.id, orderId)).get();
  return row ? rowToOrder(row) : null;
}

export function listOrdersForCustomer(db: Db, customerId: string): Order[] {
  const rows = db
    .select()
    .from(order)
    .where(eq(order.customerId, customerId))
    .orderBy(desc(order.createdAt))
    .all();
  return rows.map(rowToOrder);
}

/**
 * Recompute the order total from its line items. Used by the
 * checkout-finalize handler (the persisted total can drift if items
 * are edited after creation). Returns the recomputed total in cents.
 */
export function recomputeOrderTotal(db: Db, orderId: string): number {
  const items = listLineItemsForOrder(db, orderId);
  const total = items.reduce((s, i) => s + lineItemTotal(i), 0);
  db.update(order).set({ totalCents: total }).where(eq(order.id, orderId)).run();
  return total;
}
