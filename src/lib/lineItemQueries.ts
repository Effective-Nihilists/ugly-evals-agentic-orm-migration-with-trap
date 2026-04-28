/**
 * Polymorphic LineItem queries.
 *
 * LineItem belongs to EITHER an Order OR a Subscription. The discriminator
 * is `parent_type` and the foreign-key target is `parent_id`. Because
 * neither sqlite nor most ORMs support polymorphic relations natively,
 * we keep the wiring here so the rest of the app gets a clean interface.
 *
 * If you are reading this because you are about to migrate this module
 * to an ORM that promises to "do polymorphism for you" (some don't):
 * stop, read docs/POLYMORPHISM.md, then come back.
 */
import { asc, and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { lineItem, order, subscription } from '../schema.js';
import type { LineItem, LineItemParent, LineItemParentType, Order, Subscription } from '../types.js';
import type * as schema from '../schema.js';

type Db = BetterSQLite3Database<typeof schema>;

function toLineItem(r: typeof lineItem.$inferSelect): LineItem {
  return {
    id: r.id,
    parentType: r.parentType as LineItemParentType,
    parentId: r.parentId,
    sku: r.sku,
    qty: r.qty,
    unitPriceCents: r.unitPriceCents,
    createdAt: r.createdAt,
  };
}

export function listLineItemsForOrder(db: Db, orderId: string): LineItem[] {
  const rows = db
    .select()
    .from(lineItem)
    .where(and(eq(lineItem.parentType, 'order'), eq(lineItem.parentId, orderId)))
    .orderBy(asc(lineItem.createdAt))
    .all();
  return rows.map(toLineItem);
}

export function listLineItemsForSubscription(db: Db, subscriptionId: string): LineItem[] {
  const rows = db
    .select()
    .from(lineItem)
    .where(and(eq(lineItem.parentType, 'subscription'), eq(lineItem.parentId, subscriptionId)))
    .orderBy(asc(lineItem.createdAt))
    .all();
  return rows.map(toLineItem);
}

/**
 * Resolve a LineItem's parent to a typed object. Used by the audit
 * exporter and the customer-billing summary endpoint. Returns `null`
 * when the parent row is missing — a data-integrity warning, not an
 * error. (Don't throw here; broken-parent rows exist in production
 * for reasons that pre-date my employment.)
 */
export function resolveLineItemParent(db: Db, item: LineItem): LineItemParent | null {
  if (item.parentType === 'order') {
    const row = db.select().from(order).where(eq(order.id, item.parentId)).get();
    if (!row) return null;
    return {
      type: 'order',
      order: {
        id: row.id,
        customerId: row.customerId,
        totalCents: row.totalCents,
        status: row.status as Order['status'],
        createdAt: row.createdAt,
      },
    };
  }
  const row = db.select().from(subscription).where(eq(subscription.id, item.parentId)).get();
  if (!row) return null;
  return {
    type: 'subscription',
    subscription: {
      id: row.id,
      customerId: row.customerId,
      plan: row.plan as Subscription['plan'],
      status: row.status as Subscription['status'],
      startedAt: row.startedAt,
      cancelledAt: row.cancelledAt,
    },
  };
}

/**
 * Compute the total amount (in cents) for a LineItem. Used by every
 * invoice generator. Trivial helper but called everywhere so we keep
 * it near the queries it pairs with.
 */
export function lineItemTotal(item: LineItem): number {
  return item.qty * item.unitPriceCents;
}
